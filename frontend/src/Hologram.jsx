// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass';

// Movement speed constant
const MOVEMENT_SPEED = 0.5;
// Movement strength constant (controls amplitude)
const MOVEMENT_STRENGTH = 0.015;
// Alpha control: when line length ratio reaches this value or below, alpha becomes 1.0
const ALPHA_FULL_THRESHOLD = 1.0;
// Line thickness
const LINE_THICKNESS = 2.0;
// Minimum vertex circle size (as a fraction of full size)
const MIN_VERTEX_SIZE = 0.2;
// Maximum stretch before minimum alpha
const maxStretch = 1.1;

const headRotationConfig = {
    speed: { x: 0.3, y: 0.5, z: 0.2 },
    extent: { x: 0.08, y: 0.12, z: 0.05 }
}

// Spring physics parameters for smooth, natural movement
const stiffness = 0.25; // How quickly it responds (0-1, higher = faster) - reduced for smoother motion
const damping = 0.7; // How much it resists oscillation (0-1, higher = less bounce) - increased for less bounce
const mass = 2.5; // Mass of the system

const Hologram = forwardRef(({ containerId }, ref) => {
    const morphTargetMeshesRef = useRef([]);
    const visemeWeightsRef = useRef({});
    const currentVisemeWeightsRef = useRef({}); // Current smoothed weights
    const visemeVelocitiesRef = useRef({}); // Velocities for smooth transitions

    // Expose receiveVisemeWeights method to parent via ref
    useImperativeHandle(ref, () => ({
        receiveVisemeWeights(visemeWeights) {
            // Store viseme weights for animation
            visemeWeightsRef.current = visemeWeights;
        }
    }));

    useEffect(() => {
        // Create scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        // Create camera
        const camera = new THREE.PerspectiveCamera(
            40,
            window.innerWidth / window.innerHeight,
            0.01,
            10
        );
        camera.position.z = 3.5;
        camera.position.y = -1.0;

        // Create renderer with SSAA (Supersample Anti-Aliasing)
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.querySelector(`#${containerId}`).appendChild(renderer.domElement);

        // Set up post-processing with UnrealBloomPass
        const composer = new EffectComposer(renderer);
        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);

        // Configure UnrealBloomPass
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio()),
            0.7,    // strength (increased for more visible bloom)
            0.4,    // radius
            0.2     // threshold (lowered to allow bloom on dimmer objects)
        );
        composer.addPass(bloomPass);

        // Add SMAA antialiasing pass to fix line aliasing caused by post-processing
        const smaaPass = new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
        composer.addPass(smaaPass);

        // Store meshes with vertex data for animation
        const meshesData = [];

        let model = null;
        let animationFrameId = null;

        // Load GLB model
        const loader = new GLTFLoader();
        loader.load(
            '/face.glb',
            (gltf) => {
                model = gltf.scene;

                // Process meshes to create edge-based rendering
                model.traverse((child) => {
                    if (child.isMesh) {
                        // Check for morph targets and store reference
                        const hasMorphTargets = child.morphTargetInfluences && child.morphTargetDictionary;
                        if (hasMorphTargets) {
                            morphTargetMeshesRef.current.push(child);
                            console.log('Found mesh with morph targets:', child.name);
                            console.log('Available morph targets:', Object.keys(child.morphTargetDictionary));
                        }

                        // Hide all meshes - we'll render them with edge-based rendering
                        child.visible = false;

                        // Store original positions and random parameters for each vertex
                        const geometry = child.geometry;
                        const positionAttribute = geometry.attributes.position;
                        const vertexCount = positionAttribute.count;

                        // Clone original positions
                        const originalPositions = new Float32Array(positionAttribute.array);

                        // Extract or compute vertex normals
                        const normalAttribute = geometry.attributes.normal;
                        let vertexNormals;

                        if (normalAttribute) {
                            vertexNormals = new Float32Array(normalAttribute.array);
                        } else {
                            // Compute normals if they don't exist
                            geometry.computeVertexNormals();
                            vertexNormals = new Float32Array(geometry.attributes.normal.array);
                        }

                        // Extract vertex colors (red channel for movement strength)
                        const colorAttribute = geometry.attributes.color;
                        const vertexMovementStrengths = new Float32Array(vertexCount);

                        if (colorAttribute) {
                            // If vertex colors exist, use red channel as movement strength
                            for (let i = 0; i < vertexCount; i++) {
                                // Get red channel value (0-1 range)
                                vertexMovementStrengths[i] = colorAttribute.getX(i);
                            }
                        } else {
                            // If no vertex colors, default to full movement strength (1.0)
                            console.warn('No vertex colors found, using default movement strength of 1.0');
                            for (let i = 0; i < vertexCount; i++) {
                                vertexMovementStrengths[i] = 1.0;
                            }
                        }

                        // Generate tangent basis and random parameters for each vertex
                        // Movement will be constrained to the plane perpendicular to the vertex normal
                        const randomParams = [];
                        for (let i = 0; i < vertexCount; i++) {
                            // Get movement strength from red channel
                            const movementStrength = vertexMovementStrengths[i];

                            // Get vertex normal
                            const nx = vertexNormals[i * 3];
                            const ny = vertexNormals[i * 3 + 1];
                            const nz = vertexNormals[i * 3 + 2];

                            // Create a tangent basis (two orthogonal vectors perpendicular to the normal)
                            // Find an arbitrary vector not parallel to the normal
                            let temp = new THREE.Vector3(1, 0, 0);
                            const normal = new THREE.Vector3(nx, ny, nz);

                            // If normal is too close to (1,0,0), use (0,1,0) instead
                            if (Math.abs(normal.dot(temp)) > 0.9) {
                                temp.set(0, 1, 0);
                            }

                            // Compute first tangent vector (perpendicular to normal)
                            const tangent1 = new THREE.Vector3().crossVectors(normal, temp).normalize();

                            // Compute second tangent vector (perpendicular to both normal and tangent1)
                            const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1).normalize();

                            randomParams.push({
                                tangent1: {
                                    x: tangent1.x,
                                    y: tangent1.y,
                                    z: tangent1.z,
                                    phase: Math.random() * Math.PI * 2,
                                    frequency: 0.5 + Math.random() * 2,
                                    amplitude: (0.02 + Math.random() * 0.08) * MOVEMENT_STRENGTH * movementStrength
                                },
                                tangent2: {
                                    x: tangent2.x,
                                    y: tangent2.y,
                                    z: tangent2.z,
                                    phase: Math.random() * Math.PI * 2,
                                    frequency: 0.5 + Math.random() * 2,
                                    amplitude: (0.02 + Math.random() * 0.08) * MOVEMENT_STRENGTH * movementStrength
                                }
                            });
                        }

                        // Create edges from the geometry
                        const edges = [];
                        const indexAttribute = geometry.index;

                        if (indexAttribute) {
                            // Indexed geometry
                            for (let i = 0; i < indexAttribute.count; i += 3) {
                                const a = indexAttribute.getX(i);
                                const b = indexAttribute.getX(i + 1);
                                const c = indexAttribute.getX(i + 2);

                                // Add the three edges of the triangle
                                edges.push([a, b]);
                                edges.push([b, c]);
                                edges.push([c, a]);
                            }
                        } else {
                            // Non-indexed geometry
                            for (let i = 0; i < vertexCount; i += 3) {
                                edges.push([i, i + 1]);
                                edges.push([i + 1, i + 2]);
                                edges.push([i + 2, i]);
                            }
                        }

                        // Remove duplicate edges
                        const uniqueEdges = [];
                        const edgeSet = new Set();
                        edges.forEach(([a, b]) => {
                            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                            if (!edgeSet.has(key)) {
                                edgeSet.add(key);
                                uniqueEdges.push([a, b]);
                            }
                        });

                        // Create line segments geometry
                        const linePositions = [];
                        const lineColors = [];
                        const originalLengths = []; // Store original length for each edge

                        uniqueEdges.forEach(([a, b]) => {
                            // Add positions for both vertices of the edge
                            linePositions.push(
                                originalPositions[a * 3],
                                originalPositions[a * 3 + 1],
                                originalPositions[a * 3 + 2],
                                originalPositions[b * 3],
                                originalPositions[b * 3 + 1],
                                originalPositions[b * 3 + 2]
                            );

                            // Calculate and store original length
                            const dx = originalPositions[b * 3] - originalPositions[a * 3];
                            const dy = originalPositions[b * 3 + 1] - originalPositions[a * 3 + 1];
                            const dz = originalPositions[b * 3 + 2] - originalPositions[a * 3 + 2];
                            const originalLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
                            originalLengths.push(originalLength);

                            // Start with full opacity
                            const alpha = 1.0;

                            // Set color with alpha for both vertices (green color)
                            lineColors.push(0.1, 0.5, 2, alpha); // vertex a
                            lineColors.push(0.1, 0.5, 2, alpha); // vertex b
                        });

                        const lineGeometry = new THREE.BufferGeometry();
                        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
                        lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 4));

                        const lineMaterial = new THREE.LineBasicMaterial({
                            vertexColors: true,
                            transparent: true,
                            linewidth: 2
                        });

                        const lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);

                        // Apply the same transform as the parent mesh
                        lineSegments.position.copy(child.position);
                        lineSegments.rotation.copy(child.rotation);
                        lineSegments.scale.copy(child.scale);

                        child.parent.add(lineSegments);

                        // Build vertex connectivity map (vertex index -> list of edge indices)
                        const vertexEdges = new Map();
                        uniqueEdges.forEach((edge, edgeIndex) => {
                            const [a, b] = edge;
                            if (!vertexEdges.has(a)) vertexEdges.set(a, []);
                            if (!vertexEdges.has(b)) vertexEdges.set(b, []);
                            vertexEdges.get(a).push(edgeIndex);
                            vertexEdges.get(b).push(edgeIndex);
                        });

                        // Find vertices where more than one line meets
                        const intersectionVertices = [];
                        vertexEdges.forEach((edgeIndices, vertexIndex) => {
                            if (edgeIndices.length > 1) {
                                intersectionVertices.push({
                                    vertexIndex,
                                    edgeIndices
                                });
                            }
                        });

                        // Create points geometry for intersection vertices
                        const pointPositions = [];
                        const pointColors = [];
                        const pointSizes = []; // Store red channel values for size scaling

                        intersectionVertices.forEach(({ vertexIndex }) => {
                            pointPositions.push(
                                originalPositions[vertexIndex * 3],
                                originalPositions[vertexIndex * 3 + 1],
                                originalPositions[vertexIndex * 3 + 2]
                            );
                            // Initial color and alpha
                            pointColors.push(0.1, 0.5, 1.0, 1.0);
                            // Store red channel value (movement strength) for size scaling
                            pointSizes.push(vertexMovementStrengths[vertexIndex]);
                        });

                        const pointGeometry = new THREE.BufferGeometry();
                        pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
                        pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 4));
                        pointGeometry.setAttribute('size', new THREE.Float32BufferAttribute(pointSizes, 1));

                        // Custom shader for bright spot effect
                        const pointMaterial = new THREE.ShaderMaterial({
                            uniforms: {
                                minSize: { value: MIN_VERTEX_SIZE }
                            },
                            vertexShader: `
                                attribute vec4 color;
                                attribute float size;
                                uniform float minSize;
                                varying vec4 vColor;
                                varying float vSize;
                                
                                void main() {
                                    vColor = color;
                                    vSize = size;
                                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                                    // Scale point size based on vertex color red value
                                    // size ranges from minSize (when red=0) to 1.0 (when red=1)
                                    float sizeScale = minSize + (1.0 - minSize) * size;
                                    gl_PointSize = sizeScale * (200.0 / -mvPosition.z);
                                    gl_Position = projectionMatrix * mvPosition;
                                }
                            `,
                            fragmentShader: `
                                varying vec4 vColor;
                                varying float vSize;
                                uniform float minSize;
                                
                                void main() {
                                    vec2 p = gl_PointCoord - vec2(0.5);
                                    float len = length(p) * 50.0;
                                    float intensity = 1.0 / max(len * len * len * len, 0.1); // Prevent division by zero
                                    
                                    // Scale intensity based on vertex color red value
                                    float intensityScale = minSize + (1.0 - minSize) * vSize;
                                    intensity *= intensityScale;
                                    
                                    // Apply intensity to the color uniform
                                    vec3 finalColor = vColor.rgb * intensity;
                                    gl_FragColor = vec4(finalColor, vColor.a);
                                }
                            `,
                            transparent: true,
                            blending: THREE.AdditiveBlending,
                            depthWrite: false,
                            depthTest: false
                        });

                        const points = new THREE.Points(pointGeometry, pointMaterial);

                        // Apply the same transform as the parent mesh
                        points.position.copy(child.position);
                        points.rotation.copy(child.rotation);
                        points.scale.copy(child.scale);

                        child.parent.add(points);

                        meshesData.push({
                            mesh: child,
                            geometry,
                            originalPositions,
                            randomParams,
                            lineGeometry,
                            uniqueEdges,
                            originalLengths,
                            pointGeometry,
                            intersectionVertices,
                            hasMorphTargets
                        });
                    }
                });

                // Center and scale the model
                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                model.position.sub(center);

                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2 / maxDim;
                model.scale.setScalar(scale);

                scene.add(model);
            },
            (progress) => {
                console.log('Loading:', (progress.loaded / progress.total * 100) + '%');
            },
            (error) => {
                console.error('Error loading model:', error);
            }
        );

        // Animation loop
        const clock = new THREE.Clock();
        let previousAlphas = new Map(); // Store previous alpha values for smoothing

        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);

            const deltaTime = clock.getDelta();
            const elapsedTime = clock.getElapsedTime();

            // Apply subtle natural head rotations
            if (model) {
                // Apply non-linear time transformation for more natural, varying speeds
                // This makes the head sometimes speed up and slow down, mimicking natural breathing/idle motion
                const timeVariation = Math.sin(elapsedTime * 0.15) * 0.3 + Math.sin(elapsedTime * 0.08) * 0.2;
                const nonLinearTime = elapsedTime + timeVariation;

                // Use different sine waves with unique phases and frequencies for each axis
                // to create natural, non-repetitive movement
                const rotX = Math.sin(nonLinearTime * headRotationConfig.speed.x + 0.5) * headRotationConfig.extent.x +
                    Math.sin(nonLinearTime * headRotationConfig.speed.x * 0.7 + 2.1) * headRotationConfig.extent.x * 0.3;

                const rotY = Math.sin(nonLinearTime * headRotationConfig.speed.y + 1.2) * headRotationConfig.extent.y +
                    Math.sin(nonLinearTime * headRotationConfig.speed.y * 0.5 + 3.7) * headRotationConfig.extent.y * 0.4;

                const rotZ = Math.sin(nonLinearTime * headRotationConfig.speed.z + 2.8) * headRotationConfig.extent.z +
                    Math.sin(nonLinearTime * headRotationConfig.speed.z * 0.6 + 1.5) * headRotationConfig.extent.z * 0.5;

                model.rotation.x = rotX;
                model.rotation.y = rotY;
                model.rotation.z = rotZ;
            }

            // Apply viseme weights from audio analysis with advanced smoothing
            morphTargetMeshesRef.current.forEach((mesh) => {
                if (mesh.morphTargetDictionary) {
                    // Initialize current weights if not set
                    if (Object.keys(currentVisemeWeightsRef.current).length === 0) {
                        Object.keys(mesh.morphTargetDictionary).forEach((visemeName) => {
                            currentVisemeWeightsRef.current[visemeName] = 0;
                            visemeVelocitiesRef.current[visemeName] = 0;
                        });
                    }

                    // Apply all viseme weights with spring-based smoothing
                    Object.keys(mesh.morphTargetDictionary).forEach((visemeName) => {
                        const visemeIndex = mesh.morphTargetDictionary[visemeName];
                        const targetWeight = visemeWeightsRef.current[visemeName] || 0;
                        const currentWeight = currentVisemeWeightsRef.current[visemeName] || 0;
                        const currentVelocity = visemeVelocitiesRef.current[visemeName] || 0;

                        // Calculate spring force (frame-rate independent)
                        const springForce = (targetWeight - currentWeight) * stiffness;
                        const dampingForce = currentVelocity * damping;
                        const acceleration = (springForce - dampingForce) / mass;

                        // Update velocity and position with delta time for frame-rate independence
                        const newVelocity = currentVelocity + acceleration * Math.min(deltaTime * 60, 2);
                        const newWeight = currentWeight + newVelocity * Math.min(deltaTime * 60, 2);

                        // Clamp to valid range [0, 1]
                        const clampedWeight = Math.max(0, Math.min(1, newWeight));

                        // Store updated values
                        currentVisemeWeightsRef.current[visemeName] = clampedWeight;
                        visemeVelocitiesRef.current[visemeName] = newVelocity;

                        // Apply to mesh
                        mesh.morphTargetInfluences[visemeIndex] = clampedWeight;
                    });
                }

                // Animate eye blinks - create realistic blinking pattern
                // Blinks happen periodically with fast close and slightly slower open
                const blinkPeriod = 4.0; // Blink every 4 seconds
                const blinkDuration = 0.15; // Blink lasts 0.15 seconds
                const timeInCycle = elapsedTime % blinkPeriod;

                let blinkInfluence = 0;
                if (timeInCycle < blinkDuration) {
                    // During blink - fast close, slightly slower open
                    const blinkProgress = timeInCycle / blinkDuration;
                    if (blinkProgress < 0.4) {
                        // Close phase (first 40% of blink)
                        blinkInfluence = Math.sin((blinkProgress / 0.4) * Math.PI * 0.5);
                    } else {
                        // Open phase (remaining 60% of blink)
                        blinkInfluence = Math.cos(((blinkProgress - 0.4) / 0.6) * Math.PI * 0.5);
                    }
                }

                // Apply blink to left eye
                if (mesh.morphTargetDictionary && 'eyeBlinkLeft' in mesh.morphTargetDictionary) {
                    const eyeBlinkLeftIndex = mesh.morphTargetDictionary['eyeBlinkLeft'];
                    mesh.morphTargetInfluences[eyeBlinkLeftIndex] = blinkInfluence;
                }

                // Apply blink to right eye (with slight offset for more natural look)
                if (mesh.morphTargetDictionary && 'eyeBlinkRight' in mesh.morphTargetDictionary) {
                    const eyeBlinkRightIndex = mesh.morphTargetDictionary['eyeBlinkRight'];
                    // Add tiny offset to right eye for asymmetry
                    const offsetTime = (elapsedTime + 0.02) % blinkPeriod;
                    let rightBlinkInfluence = 0;
                    if (offsetTime < blinkDuration) {
                        const blinkProgress = offsetTime / blinkDuration;
                        if (blinkProgress < 0.4) {
                            rightBlinkInfluence = Math.sin((blinkProgress / 0.4) * Math.PI * 0.5);
                        } else {
                            rightBlinkInfluence = Math.cos(((blinkProgress - 0.4) / 0.6) * Math.PI * 0.5);
                        }
                    }
                    mesh.morphTargetInfluences[eyeBlinkRightIndex] = rightBlinkInfluence;
                }
            });

            // Animate vertices for all meshes
            meshesData.forEach(({ mesh, geometry, originalPositions, randomParams, lineGeometry, uniqueEdges, originalLengths, pointGeometry, intersectionVertices, hasMorphTargets }) => {
                const positionAttribute = geometry.attributes.position;

                // Create temporary array to store animated base positions (with random movement only)
                const animatedBasePositions = new Float32Array(originalPositions.length);

                // First, calculate animated base positions with random movement only
                // Movement is constrained to the tangent plane (perpendicular to vertex normal)
                for (let i = 0; i < randomParams.length; i++) {
                    const params = randomParams[i];

                    // Calculate movement along each tangent direction
                    const t1Magnitude = Math.sin(elapsedTime * params.tangent1.frequency * MOVEMENT_SPEED + params.tangent1.phase) * params.tangent1.amplitude;
                    const t2Magnitude = Math.sin(elapsedTime * params.tangent2.frequency * MOVEMENT_SPEED + params.tangent2.phase) * params.tangent2.amplitude;

                    // Combine the two tangent movements to get the final offset
                    const offsetX = params.tangent1.x * t1Magnitude + params.tangent2.x * t2Magnitude;
                    const offsetY = params.tangent1.y * t1Magnitude + params.tangent2.y * t2Magnitude;
                    const offsetZ = params.tangent1.z * t1Magnitude + params.tangent2.z * t2Magnitude;

                    // Store animated base positions (original + tangent plane movement)
                    const idx = i * 3;
                    animatedBasePositions[idx] = originalPositions[idx] + offsetX;
                    animatedBasePositions[idx + 1] = originalPositions[idx + 1] + offsetY;
                    animatedBasePositions[idx + 2] = originalPositions[idx + 2] + offsetZ;
                }

                // Now calculate colors based on animated base positions only
                const linePositions = lineGeometry.attributes.position.array;
                const lineColors = lineGeometry.attributes.color.array;

                uniqueEdges.forEach(([a, b], edgeIndex) => {
                    const colorIndex = edgeIndex * 8; // 2 vertices * 4 components (RGBA)

                    // Get animated base positions (without morph targets) for color calculation
                    const ax = animatedBasePositions[a * 3];
                    const ay = animatedBasePositions[a * 3 + 1];
                    const az = animatedBasePositions[a * 3 + 2];
                    const bx = animatedBasePositions[b * 3];
                    const by = animatedBasePositions[b * 3 + 1];
                    const bz = animatedBasePositions[b * 3 + 2];

                    // Calculate current distance between vertices (based on animated base positions)
                    const dx = bx - ax;
                    const dy = by - ay;
                    const dz = bz - az;
                    const currentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    // Calculate length ratio (current / original)
                    const originalLength = originalLengths[edgeIndex];
                    const lengthRatio = currentLength / originalLength;

                    let targetAlpha;
                    if (lengthRatio <= ALPHA_FULL_THRESHOLD) {
                        // Line is compressed to threshold or below = fully opaque
                        targetAlpha = 1.0;
                    } else {
                        // Line is stretched beyond threshold = calculate falloff
                        // Map how much it exceeds the threshold to alpha

                        const stretchAmount = lengthRatio - ALPHA_FULL_THRESHOLD;
                        const maxStretchAmount = maxStretch - ALPHA_FULL_THRESHOLD;
                        const normalizedStretch = Math.min(stretchAmount / maxStretchAmount, 1.0);
                        // Square for exponential falloff
                        targetAlpha = Math.max(0.0, 1.0 - (normalizedStretch * normalizedStretch));
                    }

                    // Smooth alpha transitions to prevent flicker
                    const alphaKey = edgeIndex;
                    const previousAlpha = previousAlphas.get(alphaKey) || targetAlpha;
                    const alphaSmoothing = 0.05; // Lower = smoother but slower response (reduced from 0.15)
                    const alpha = previousAlpha + (targetAlpha - previousAlpha) * alphaSmoothing;
                    previousAlphas.set(alphaKey, alpha);

                    // Calculate z-based fade factor for vertex a (fade out towards -z from z=0)
                    // When z >= 0: full brightness (factor = 1.0)
                    // When z < 0: fade out proportionally
                    const zFadeA = az >= 0 ? 1.0 : Math.max(0.0, 1.0 + az);

                    // Calculate z-based fade factor for vertex b
                    const zFadeB = bz >= 0 ? 1.0 : Math.max(0.0, 1.0 + bz);

                    // Base color (green/blue)
                    const baseR = 0.1;
                    const baseG = 0.5;
                    const baseB = 2.0;

                    // Apply z-based fade to RGB components for vertex a
                    lineColors[colorIndex] = baseR * zFadeA;
                    lineColors[colorIndex + 1] = baseG * zFadeA;
                    lineColors[colorIndex + 2] = baseB * zFadeA;
                    lineColors[colorIndex + 3] = alpha;

                    // Apply z-based fade to RGB components for vertex b
                    lineColors[colorIndex + 4] = baseR * zFadeB;
                    lineColors[colorIndex + 5] = baseG * zFadeB;
                    lineColors[colorIndex + 6] = baseB * zFadeB;
                    lineColors[colorIndex + 7] = alpha;
                });

                lineGeometry.attributes.color.needsUpdate = true;

                // Now apply final positions (animated base + morph targets if applicable)
                if (hasMorphTargets) {
                    // For meshes with morph targets, start with animated base positions
                    for (let i = 0; i < animatedBasePositions.length; i++) {
                        positionAttribute.array[i] = animatedBasePositions[i];
                    }

                    // Apply each morph target based on its influence
                    const morphAttributes = geometry.morphAttributes.position;
                    if (morphAttributes && mesh.morphTargetInfluences) {
                        for (let i = 0; i < morphAttributes.length; i++) {
                            const influence = mesh.morphTargetInfluences[i];
                            if (influence !== 0) {
                                const morphAttribute = morphAttributes[i];
                                for (let j = 0; j < positionAttribute.count; j++) {
                                    positionAttribute.array[j * 3] += morphAttribute.getX(j) * influence;
                                    positionAttribute.array[j * 3 + 1] += morphAttribute.getY(j) * influence;
                                    positionAttribute.array[j * 3 + 2] += morphAttribute.getZ(j) * influence;
                                }
                            }
                        }
                    }
                } else {
                    // For meshes without morph targets, just use animated base positions
                    for (let i = 0; i < animatedBasePositions.length; i++) {
                        positionAttribute.array[i] = animatedBasePositions[i];
                    }
                }

                positionAttribute.needsUpdate = true;

                // Update line segment positions (using final positions including morph targets)
                uniqueEdges.forEach(([a, b], edgeIndex) => {
                    const lineIndex = edgeIndex * 6; // 2 vertices * 3 coordinates

                    // Get final positions from the animated geometry (includes morph targets)
                    const ax = positionAttribute.array[a * 3];
                    const ay = positionAttribute.array[a * 3 + 1];
                    const az = positionAttribute.array[a * 3 + 2];
                    const bx = positionAttribute.array[b * 3];
                    const by = positionAttribute.array[b * 3 + 1];
                    const bz = positionAttribute.array[b * 3 + 2];

                    // Update line positions
                    linePositions[lineIndex] = ax;
                    linePositions[lineIndex + 1] = ay;
                    linePositions[lineIndex + 2] = az;
                    linePositions[lineIndex + 3] = bx;
                    linePositions[lineIndex + 4] = by;
                    linePositions[lineIndex + 5] = bz;
                });

                lineGeometry.attributes.position.needsUpdate = true;

                // Update point positions and alpha based on average of connected lines
                if (pointGeometry && intersectionVertices) {
                    const pointPositions = pointGeometry.attributes.position.array;
                    const pointColors = pointGeometry.attributes.color.array;

                    intersectionVertices.forEach(({ vertexIndex, edgeIndices }, pointIndex) => {
                        // Update position from final animated geometry (includes morph targets)
                        const px = positionAttribute.array[vertexIndex * 3];
                        const py = positionAttribute.array[vertexIndex * 3 + 1];
                        const pz = positionAttribute.array[vertexIndex * 3 + 2];

                        pointPositions[pointIndex * 3] = px;
                        pointPositions[pointIndex * 3 + 1] = py;
                        pointPositions[pointIndex * 3 + 2] = pz;

                        // Calculate z-based fade factor (fade out towards -z from z=0)
                        const zFade = pz >= 0 ? 1.0 : Math.max(0.0, 1.0 + pz);

                        // Base color (blue)
                        const baseR = 0.1;
                        const baseG = 0.5;
                        const baseB = 1.0;

                        // Apply z-based fade to RGB components
                        pointColors[pointIndex * 4] = baseR * zFade;
                        pointColors[pointIndex * 4 + 1] = baseG * zFade;
                        pointColors[pointIndex * 4 + 2] = baseB * zFade;

                        // Calculate average alpha from connected edges
                        let alphaSum = 0;
                        edgeIndices.forEach(edgeIndex => {
                            const colorIndex = edgeIndex * 8; // 2 vertices * 4 components (RGBA)
                            // Get alpha from first vertex of the edge
                            alphaSum += lineColors[colorIndex + 3];
                        });
                        const avgAlpha = alphaSum / edgeIndices.length;

                        // Update point alpha
                        pointColors[pointIndex * 4 + 3] = avgAlpha;
                    });

                    pointGeometry.attributes.position.needsUpdate = true;
                    pointGeometry.attributes.color.needsUpdate = true;
                }
            });

            composer.render();
        };
        animate();

        // Handle window resize
        const handleResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => {
            // Cancel animation loop first
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }

            window.removeEventListener('resize', handleResize);

            // Clean up Three.js resources
            meshesData.forEach(({ lineGeometry, pointGeometry }) => {
                if (lineGeometry) lineGeometry.dispose();
                if (pointGeometry) pointGeometry.dispose();
            });

            scene.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });

            // Clean up renderer
            const container = document.querySelector(`#${containerId}`);
            if (container && renderer.domElement.parentNode === container) {
                container.removeChild(renderer.domElement);
            }
            composer.dispose();
            renderer.dispose();

            console.log('Cleanup completed');
        };
    }, [containerId]);

    return <div></div>;
});

Hologram.displayName = 'Hologram';

export default Hologram;
