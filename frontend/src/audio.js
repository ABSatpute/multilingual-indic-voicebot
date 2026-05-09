// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useRef } from 'react';

const SAMPLE_RATE = 16000;

export const floatToPcm16 = (input) => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
};

export const pcm16ToFloat = (buffer) => {
    const dataView = new DataView(buffer);
    const float32 = new Float32Array(buffer.byteLength / 2);
    for (let i = 0; i < float32.length; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        float32[i] = int16 / 32768.0;
    }
    return float32;
};

function useAudio() {
    const audioContextRef = useRef(null);
    const audioWorkletNodeRef = useRef(null);

    const initAudioWorklet = async () => {
        try {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: SAMPLE_RATE
            });

            await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
            audioWorkletNodeRef.current = new AudioWorkletNode(
                audioContextRef.current,
                'audio-processor'
            );

            audioWorkletNodeRef.current.port.onmessage = (event) => {
                if (event.data === 'needData') {
                    // setTalking(false);
                }
            };

            audioWorkletNodeRef.current.connect(audioContextRef.current.destination);
            await audioContextRef.current.resume();
        } catch (error) {
            console.error('Failed to initialize AudioWorklet:', error);
        }
    };

    const initMicrophone = async (onAudioCapture) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1
                }
            });
            const source = audioContextRef.current.createMediaStreamSource(stream);
            const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            source.connect(processor);

            const gainNode = audioContextRef.current.createGain();
            gainNode.gain.value = 0;
            processor.connect(gainNode);
            gainNode.connect(audioContextRef.current.destination);

            processor.onaudioprocess = (event) => {
                const input = event.inputBuffer.getChannelData(0);
                const pcm16 = floatToPcm16(input);
                const buffer = new ArrayBuffer(pcm16.length * 2);
                const view = new DataView(buffer);
                pcm16.forEach((value, index) => view.setInt16(index * 2, value, true));
                const bytes = new Uint8Array(buffer);
                const base64 = btoa(String.fromCharCode.apply(null, bytes));

                const mediaObject = {
                    event: 'media',
                    data: base64
                };
                onAudioCapture(JSON.stringify(mediaObject));
            };
        } catch (error) {
            console.error('Failed to initialize microphone:', error);
        }
    };

    const initAudio = async (onAudioCapture) => {
        await initAudioWorklet();
        await initMicrophone(onAudioCapture);
    }

    const playChunk = (float32Array) => {
        audioWorkletNodeRef.current?.port.postMessage({
            type: 'data',
            audio: float32Array
        });
    }

    const stopAudio = () => {
        audioWorkletNodeRef.current?.port.postMessage({
            type: 'stop'
        });
    }

    const cleanupAudio = () => {
        if (audioContextRef.current?.state !== 'closed') {
            if (audioWorkletNodeRef.current) {
                audioWorkletNodeRef.current.disconnect();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        }
    };

    return [
        initAudio,
        playChunk,
        stopAudio,
        cleanupAudio,
    ];
};
export default useAudio;