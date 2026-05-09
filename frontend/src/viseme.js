// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export const get_rest_pose_visemes = () => {
    return {
        viseme_sil: 0,
        viseme_PP: 0,
        viseme_FF: 0,
        viseme_TH: 0,
        viseme_DD: 0,
        viseme_kk: 0,
        viseme_CH: 0,
        viseme_SS: 0,
        viseme_nn: 0,
        viseme_RR: 0,
        viseme_aa: 0,
        viseme_E: 0,
        viseme_I: 0,
        viseme_O: 0,
        viseme_U: 0
    };
}

// DSP-based viseme weight calculation
export const calculateVisemeWeights = (pcmData) => {
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0; // Convert Int16 to Float32 [-1, 1]
    }

    // Calculate audio features
    const rms = calculateRMS(floatData);
    const zcr = calculateZCR(floatData);
    const spectralCentroid = calculateSpectralCentroid(floatData);
    const formants = estimateFormants(floatData);

    // Initialize viseme weights
    const visemes = get_rest_pose_visemes();

    // Silence detection (low RMS energy)
    if (rms < 0.01) {
        visemes.viseme_sil = 1.0;
        return visemes;
    }

    // High ZCR indicates fricatives/sibilants
    if (zcr > 0.15) {
        if (spectralCentroid > 4000) {
            visemes.viseme_SS = 0.7; // s, z sounds
            visemes.viseme_CH = 0.3; // ch, sh sounds
        } else if (spectralCentroid > 2500) {
            visemes.viseme_FF = 0.6; // f, v sounds
            visemes.viseme_TH = 0.4; // th sounds
        } else {
            visemes.viseme_CH = 0.5; // ch, j, sh sounds
            visemes.viseme_SS = 0.5;
        }
        return visemes;
    }

    // Low ZCR indicates vowels or nasals
    if (zcr < 0.05) {
        // Vowel detection based on formants
        const f1 = formants.f1;
        const f2 = formants.f2;

        // Vowel classification based on formant frequencies
        // aa: low F1, low F2 (as in "father")
        if (f1 < 700 && f2 < 1300) {
            visemes.viseme_aa = 0.8;
            visemes.viseme_O = 0.2;
        }
        // E: mid F1, high F2 (as in "bet")
        else if (f1 >= 400 && f1 < 650 && f2 > 1800) {
            visemes.viseme_E = 0.9;
            visemes.viseme_I = 0.1;
        }
        // I: low F1, very high F2 (as in "beat")
        else if (f1 < 400 && f2 > 2200) {
            visemes.viseme_I = 0.9;
            visemes.viseme_E = 0.1;
        }
        // O: low F1, low-mid F2 (as in "boat")
        else if (f1 < 500 && f2 >= 800 && f2 < 1200) {
            visemes.viseme_O = 0.8;
            visemes.viseme_U = 0.2;
        }
        // U: very low F1, very low F2 (as in "boot")
        else if (f1 < 350 && f2 < 1000) {
            visemes.viseme_U = 0.9;
            visemes.viseme_O = 0.1;
        }
        // Default to neutral vowel
        else {
            visemes.viseme_E = 0.5;
            visemes.viseme_aa = 0.3;
        }

        // Add nasal component for mid-range frequencies
        if (f1 > 300 && f1 < 600) {
            visemes.viseme_nn = 0.3;
        }
    }
    // Medium ZCR indicates plosives or mixed sounds
    else {
        const energy = rms * 10; // Amplify for detection

        if (spectralCentroid < 1500) {
            // Low frequency plosives (b, p, m)
            visemes.viseme_PP = Math.min(0.8, energy);
            visemes.viseme_nn = 0.2;
        } else if (spectralCentroid < 2500) {
            // Mid frequency plosives (d, t)
            visemes.viseme_DD = Math.min(0.7, energy);
            visemes.viseme_nn = 0.3;
        } else if (spectralCentroid < 3500) {
            // Higher frequency plosives (k, g)
            visemes.viseme_kk = Math.min(0.7, energy);
            visemes.viseme_CH = 0.3;
        } else {
            // Very high frequency (r sounds)
            visemes.viseme_RR = 0.6;
            visemes.viseme_nn = 0.4;
        }
    }

    // Normalize weights to sum to 1.0
    const sum = Object.values(visemes).reduce((a, b) => a + b, 0);
    if (sum > 0) {
        Object.keys(visemes).forEach(key => {
            visemes[key] /= sum;
        });
    }

    return visemes;
};

// Calculate RMS (Root Mean Square) energy
const calculateRMS = (data) => {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
};

// Calculate Zero-Crossing Rate
const calculateZCR = (data) => {
    let crossings = 0;
    for (let i = 1; i < data.length; i++) {
        if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) {
            crossings++;
        }
    }
    return crossings / (data.length - 1);
};

// Calculate Spectral Centroid
const calculateSpectralCentroid = (data) => {
    // Simple FFT approximation using autocorrelation
    const fftSize = Math.min(2048, data.length);
    const magnitude = new Array(fftSize / 2).fill(0);

    // Calculate power spectrum
    for (let k = 0; k < fftSize / 2; k++) {
        let real = 0;
        let imag = 0;
        for (let n = 0; n < fftSize; n++) {
            const angle = (2 * Math.PI * k * n) / fftSize;
            real += data[n] * Math.cos(angle);
            imag += data[n] * Math.sin(angle);
        }
        magnitude[k] = Math.sqrt(real * real + imag * imag);
    }

    // Calculate centroid
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < magnitude.length; i++) {
        const frequency = (i * 16000) / fftSize; // 16kHz sample rate
        weightedSum += frequency * magnitude[i];
        magnitudeSum += magnitude[i];
    }

    return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
};

// Estimate formant frequencies using LPC (simplified)
const estimateFormants = (data) => {
    // Simplified formant estimation using peak detection in autocorrelation
    const maxLag = Math.min(400, Math.floor(data.length / 2));
    const autocorr = new Array(maxLag).fill(0);

    // Calculate autocorrelation
    for (let lag = 0; lag < maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < data.length - lag; i++) {
            sum += data[i] * data[i + lag];
        }
        autocorr[lag] = sum;
    }

    // Find peaks in autocorrelation (simplified formant detection)
    const peaks = [];
    for (let i = 20; i < maxLag - 1; i++) {
        if (autocorr[i] > autocorr[i - 1] && autocorr[i] > autocorr[i + 1]) {
            const frequency = 16000 / i; // Convert lag to frequency
            if (frequency > 200 && frequency < 4000) {
                peaks.push({ freq: frequency, magnitude: autocorr[i] });
            }
        }
    }

    // Sort by magnitude and take top 2 as F1 and F2
    peaks.sort((a, b) => b.magnitude - a.magnitude);

    return {
        f1: peaks[0]?.freq || 500,
        f2: peaks[1]?.freq || 1500
    };
};