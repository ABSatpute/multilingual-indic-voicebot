// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';

import '@aws-amplify/ui-react/styles.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';

import App from './App.jsx';

const response = await fetch('/aws-exports.json')
if (!response.ok) {
    throw new Error('Failed to load AWS configuration')
}
const awsConfig = await response.json()
Amplify.configure(awsConfig.amplify);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App apiUrl={awsConfig.websocket.apiUrl} />
    </React.StrictMode>
);

