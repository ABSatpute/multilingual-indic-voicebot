// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Authenticator } from '@aws-amplify/ui-react';
import Content from './Content.jsx'
import './App.css';

function App({ apiUrl }) {
    const components = {
        Header() {
            return (
                <div className='d-flex flex-column justify-content-center text-center' style={{ paddingTop: "20%" }}>
                    <p className='h1'>
                        Employee support voicebot
                    </p>
                    <p className='h5 mb-5 text-secondary'>
                        Developed by PACE India
                    </p>
                </div>
            );
        }
    }

    return (
        <div className='app'>
            <Authenticator
                loginMechanisms={['email']}  // Only allow email-based login
                components={components}      // Use custom components
                hideSignUp                   // Disable self-service sign up
            >
                {({ signOut, user }) => (
                    <Content signOut={signOut} user={user} apiUrl={apiUrl} />
                )}
            </Authenticator>
        </div>
    );
}

export default App;
