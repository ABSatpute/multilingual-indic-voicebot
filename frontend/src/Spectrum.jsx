// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

const BAR_COUNT = 80;
const MIN_FREQ = 1000;
const MAX_FREQ = 8000;

const Spectrum = forwardRef(({ color = '#00ff55', isFlipped = false }, ref) => {
    // Refs for DOM manipulation and audio analysis
    const containerRef = useRef(null); // Container for all spectrum bars
    const barsRef = useRef([]); // Array of individual bar DOM elements
    const analyserRef = useRef(null); // Web Audio API analyser node
    const dataArrayRef = useRef(null); // Buffer for frequency data
    const animationFrameRef = useRef(null); // Animation loop ID
    const sampleRateRef = useRef(48000); // Audio sample rate (default 48kHz)

    // Expose methods to parent component via ref
    useImperativeHandle(ref, () => ({
        setAnalyser: (analyser, sampleRate) => {
            analyserRef.current = analyser;
            sampleRateRef.current = sampleRate;

            if (analyser) {
                // Allocate buffer for frequency data
                dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
                // Start animation loop if not already running
                if (!animationFrameRef.current) {
                    animate();
                }
            }
        },
        reset: () => {
            // Reset all bars to minimum scale (resting position)
            for (let i = 0; i < barsRef.current.length; i++) {
                if (barsRef.current[i]) {
                    barsRef.current[i].style.transform = 'scaleY(0.05)';
                }
            }
        },
        cleanup: () => {
            // Stop animation loop
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            // Clear references
            analyserRef.current = null;
            dataArrayRef.current = null;
        }
    }));

    // Convert frequency (Hz) to array index in frequency data
    const freqToIndex = (freq, sampleRate, dataArrayLength) => {
        // Nyquist frequency is sampleRate/2
        return Math.round(freq / (sampleRate / 2) * dataArrayLength);
    };

    // Logarithmic interpolation for natural frequency distribution
    const logInterpolate = (min, max, ratio) => {
        const minLog = Math.log10(min); // Log of minimum value
        const maxLog = Math.log10(max); // Log of maximum value
        const valueLog = minLog + (maxLog - minLog) * ratio; // Interpolate in log space
        return Math.pow(10, valueLog); // Convert back to linear scale
    };

    // Animation loop that updates all bars based on frequency data
    const animate = () => {
        // Schedule next frame
        animationFrameRef.current = requestAnimationFrame(animate);

        // Exit if analyser or data buffer not ready
        if (!analyserRef.current || !dataArrayRef.current) return;

        // Get current frequency data from audio analyser
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        // Update each bar based on its frequency range
        for (let i = 0; i < BAR_COUNT; i++) {
            // Calculate frequency range for this bar (logarithmic distribution)
            const startFreq = logInterpolate(MIN_FREQ, MAX_FREQ, i / BAR_COUNT);
            const endFreq = logInterpolate(MIN_FREQ, MAX_FREQ, (i + 1) / BAR_COUNT);

            // Convert frequencies to data array indices
            const startIndex = freqToIndex(startFreq, sampleRateRef.current, dataArrayRef.current.length);
            const endIndex = freqToIndex(endFreq, sampleRateRef.current, dataArrayRef.current.length);

            // Calculate average amplitude in this frequency range
            let sum = 0;
            let count = 0;

            for (let j = startIndex; j <= endIndex; j++) {
                sum += dataArrayRef.current[j];
                count++;
            }

            // Normalize to 0-1 range (byte values are 0-255)
            let value = (sum / count) / 255;

            // Apply minimum scale to keep bars visible
            const scaled = Math.max(0.05, value);

            // Update bar height via CSS transform
            if (barsRef.current[i]) {
                barsRef.current[i].style.transform = `scaleY(${scaled})`;
            }
        }
    };

    // Outer container style - centers the visualizer and adds glow effect
    const containerStyle = {
        position: 'absolute',
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        mixBlendMode: 'screen' // Creates additive blending for glow effect
    };

    // Inner visualizer style - arranges bars horizontally
    const visualizerStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '3px' // Space between bars
    };

    // Lighten a hex color by mixing it with white
    const lightenColor = (hexColor, percent) => {
        const hex = hexColor.replace('#', ''); // Remove # symbol

        // Parse hex to RGB
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        // Interpolate between original color and white
        const newR = Math.round(r + (255 - r) * percent);
        const newG = Math.round(g + (255 - g) * percent);
        const newB = Math.round(b + (255 - b) * percent);

        // Convert back to hex
        const toHex = (n) => {
            const hex = n.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };

        return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        barsRef.current = [];
        container.innerHTML = '';

        // Create lighter color for gradient center (40% lighter)
        const lighterColor = lightenColor(color, 0.4);

        for (let i = 0; i < BAR_COUNT; i++) {
            const bar = document.createElement('div');
            bar.style.width = '4px';
            bar.style.height = '160px';
            // Gradient: original color at top/bottom, lighter in middle
            bar.style.background = `linear-gradient(to bottom, ${color} 0%, ${lighterColor} 50%, ${color} 100%)`;
            bar.style.borderRadius = '3px';
            bar.style.transformOrigin = 'center';
            bar.style.transform = 'scaleY(0.05)';
            bar.style.willChange = 'transform';
            bar.style.boxShadow = `0 0 6px ${color}, 0 0 12px ${color}, 0 0 24px ${color}`;
            container.appendChild(bar);
            barsRef.current.push(bar);
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [color]);

    return (
        <div style={containerStyle}>
            <div style={visualizerStyle} ref={containerRef}></div>
        </div>
    );
});

Spectrum.displayName = 'Spectrum';

export default Spectrum;
