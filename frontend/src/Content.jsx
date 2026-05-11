// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, useRef, useEffect } from 'react';
import { Navbar, Nav, Modal, Button, Form } from 'react-bootstrap';
import { fetchAuthSession } from 'aws-amplify/auth';

import './App.css';
import useAudio, { pcm16ToFloat } from './audio.js'
import Hologram from './Hologram.jsx';
import Spectrum from './Spectrum.jsx';
import { get_rest_pose_visemes, calculateVisemeWeights } from './viseme.js';

const PIPELINES = [
    {
        value: 'transcribe-polly',
        label: 'Transcribe and Polly',
        languages: [
            { value: 'english', label: 'English' },
            { value: 'hindi', label: 'Hindi' }
        ]
    },
    {
        value: 'sarvam',
        label: 'Sarvam AI (Indic languages)',
        languages: [
            { value: 'english', label: 'English' },
            { value: 'hindi', label: 'Hindi' },
            { value: 'bengali', label: 'Bengali' },
            { value: 'gujarati', label: 'Gujarati' },
            { value: 'kannada', label: 'Kannada' },
            { value: 'malayalam', label: 'Malayalam' },
            { value: 'marathi', label: 'Marathi' },
            { value: 'tamil', label: 'Tamil' },
            { value: 'telugu', label: 'Telugu' },
            { value: 'odia', label: 'Odia' },
            { value: 'punjabi', label: 'Punjabi' },
            { value: 'assamese', label: 'Assamese' }
        ]
    },
    {
        value: 'novasonic',
        label: 'Nova sonic',
        languages: [
            { value: 'english', label: 'English' },
            { value: 'hindi', label: 'Hindi' },
        ]
    }
];

const VISUALIZATIONS = [
    { value: 'hologram', label: 'Hologram' },
    { value: 'bars', label: 'Spectrum bars' }
];

function Content({ signOut, user, apiUrl }) {
    const [headerVisible, setHeaderVisible] = useState(true);
    const [isEngaged, setEngaged] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState(() => {
        const savedSettings = localStorage.getItem('settings');
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                // Validate saved pipeline still exists
                const validPipeline = PIPELINES.find(p => p.value === parsed.pipeline);
                if (validPipeline) return parsed;
            } catch (error) {
                console.error('Error loading settings from localStorage:', error);
            }
        }
        return {
            pipeline: PIPELINES[0].value,
            language: PIPELINES[0].languages[0].value,
            visualization: VISUALIZATIONS[0].value
        };
    });

    const wsRef = useRef(null);
    const hologramRef = useRef(null);
    const micSpectrumRef = useRef(null);
    const botSpectrumRef = useRef(null);
    const micAnalyserRef = useRef(null);
    const botAnalyserRef = useRef(null);
    const audioContextRef = useRef(null);
    const [initAudio, playChunk, stopAudio, cleanupAudio] = useAudio();

    useEffect(() => {
        localStorage.setItem('settings', JSON.stringify(settings));
    }, [settings]);

    const engage = async () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.close();
        }

        console.log('Connecting ', apiUrl)
        const token = (await fetchAuthSession()).tokens.idToken.toString();
        wsRef.current = new WebSocket(`${apiUrl}?token=${token}&pipeline=${settings.pipeline}&language=${settings.language}`);

        wsRef.current.onopen = async () => {
            initAudio(onAudioCapture);

            if (settings.visualization === 'bars') {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
                const sampleRate = audioContextRef.current.sampleRate;

                // Create mic analyser
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const micSource = audioContextRef.current.createMediaStreamSource(stream);
                    micAnalyserRef.current = audioContextRef.current.createAnalyser();
                    micAnalyserRef.current.fftSize = 2048;
                    micAnalyserRef.current.smoothingTimeConstant = 0.85;
                    micSource.connect(micAnalyserRef.current);

                    if (micSpectrumRef.current) {
                        micSpectrumRef.current.setAnalyser(micAnalyserRef.current, sampleRate);
                    }
                } catch (error) {
                    console.error('Error initializing mic analyser:', error);
                }

                // Create bot analyser
                botAnalyserRef.current = audioContextRef.current.createAnalyser();
                botAnalyserRef.current.fftSize = 2048;
                botAnalyserRef.current.smoothingTimeConstant = 0.85;

                if (botSpectrumRef.current) {
                    botSpectrumRef.current.setAnalyser(botAnalyserRef.current, sampleRate);
                }
            }
        };

        wsRef.current.onmessage = async (event) => {
            const chunk = JSON.parse(event.data);

            if (chunk.event !== "media") {
                console.log(chunk)
            }

            if (chunk.event === 'stop' || chunk.event === 'interruption') {
                stopAudio();
                stopTalking();

            } else if (chunk.event === 'media') {
                try {
                    const base64Data = chunk.data;
                    const binaryString = atob(base64Data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    const float32Array = pcm16ToFloat(bytes.buffer);

                    const pcmData = new Int16Array(float32Array.length);
                    for (let i = 0; i < float32Array.length; i++) {
                        // Clamp to [-1, 1] and convert to 16-bit integer
                        const s = Math.max(-1, Math.min(1, float32Array[i]));
                        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }

                    const visemeWeights = calculateVisemeWeights(pcmData);
                    if (hologramRef.current) {
                        hologramRef.current.receiveVisemeWeights(visemeWeights);
                    }

                    if (botAnalyserRef.current && audioContextRef.current && settings.visualization === 'bars') {
                        const buffer = audioContextRef.current.createBuffer(1, float32Array.length, audioContextRef.current.sampleRate);
                        buffer.copyToChannel(float32Array, 0);
                        const source = audioContextRef.current.createBufferSource();
                        source.buffer = buffer;
                        source.connect(botAnalyserRef.current);
                        source.start();
                    }

                    if (float32Array.length > 0) {
                        playChunk(float32Array);
                    }
                } catch (error) {
                    console.error('Error processing audio data:', error);
                }
            }
        };

        wsRef.current.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        wsRef.current.onclose = (event) => {
            console.log('WebSocket closed:', event);
            setEngaged(false);
        };
    };

    const stopTalking = () => {
        if (hologramRef.current) {
            const visemeWeights = get_rest_pose_visemes();
            hologramRef.current.receiveVisemeWeights(visemeWeights);
        }
    }

    const onAudioCapture = (payload) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(payload);
        }
    };

    const disengage = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.close();
        }

        stopTalking();
        cleanupAudio();

        if (micSpectrumRef.current) {
            micSpectrumRef.current.reset();
            micSpectrumRef.current.cleanup();
        }
        if (botSpectrumRef.current) {
            botSpectrumRef.current.reset();
            botSpectrumRef.current.cleanup();
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }
    };

    useEffect(() => {
        isEngaged ? engage() : disengage();
        return disengage;
    }, [isEngaged]);

    return (
        <div className="app">
            <Navbar
                className='header'
                bg='light'
                expand='lg'
                style={{
                    transition: 'opacity 0.3s ease',
                    display: headerVisible ? 'flex' : 'none',
                    pointerEvents: headerVisible ? 'auto' : 'none'
                }}
            >
                <Navbar.Brand className='px-4'>Employee support voicebot</Navbar.Brand>
                {
                    <Nav className='d-flex flex-row p-2 nav-strip flex-grow-1 justify-content-end'>
                        <Nav.Link onClick={() => {
                            setEngaged(!isEngaged)
                        }}>
                            {isEngaged ? 'Disengage' : 'Engage'}
                        </Nav.Link>

                        <Nav.Link
                            onClick={isEngaged ? undefined : () => setShowSettings(true)}
                            style={{
                                opacity: isEngaged ? 0.5 : 1,
                                cursor: isEngaged ? 'not-allowed' : 'pointer'
                            }}>
                            Settings
                        </Nav.Link>

                        <Nav.Link
                            onClick={signOut}
                            style={{
                                opacity: isEngaged ? 0.5 : 1,
                                cursor: isEngaged ? 'not-allowed' : 'pointer'
                            }}>
                            Logout
                        </Nav.Link>
                    </Nav >
                }
            </Navbar >

            < div className="main-container" onClick={() => setHeaderVisible(!headerVisible)}>
                <div id="app" style={{ width: '100%', height: '100%', position: 'relative', background: 'radial-gradient(circle at center, #102010 0%, #000 70%)' }}>
                    {settings.visualization === 'hologram' ? (
                        <Hologram ref={hologramRef} containerId={"app"} />
                    ) : (
                        <>
                            <Spectrum ref={micSpectrumRef} color="#01ff01" />
                            <Spectrum ref={botSpectrumRef} color="#0101ff" />
                        </>
                    )}
                </div>
            </div >

            <Modal show={showSettings} onHide={() => setShowSettings(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Settings</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Pipeline</Form.Label>
                            <Form.Select
                                value={settings.pipeline}
                                onChange={(e) => setSettings(prev => ({
                                    ...prev,
                                    pipeline: e.target.value
                                }))}
                            >
                                {PIPELINES.map(pipeline => (
                                    <option key={pipeline.value} value={pipeline.value}>
                                        {pipeline.label}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Language</Form.Label>
                            <Form.Select
                                value={settings.language}
                                onChange={(e) => setSettings(prev => ({
                                    ...prev,
                                    language: e.target.value
                                }))}
                            >
                                {PIPELINES.find(pipeline => pipeline.value === settings.pipeline).languages.map(language => (
                                    <option key={language.value} value={language.value}>
                                        {language.label}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Visualization</Form.Label>
                            <Form.Select
                                value={settings.visualization}
                                onChange={(e) => setSettings(prev => ({
                                    ...prev,
                                    visualization: e.target.value
                                }))}
                            >
                                {VISUALIZATIONS.map(visualization => (
                                    <option key={visualization.value} value={visualization.value}>
                                        {visualization.label}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    </Form>
                </Modal.Body>
            </Modal>
        </div >
    );
}

export default Content;
