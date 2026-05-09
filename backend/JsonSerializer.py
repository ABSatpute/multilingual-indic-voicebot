# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Base64 Audio Serializer for WebSocket Communication

This module provides a serializer for handling base64-encoded audio data over WebSocket connections.
It supports bidirectional conversion between raw PCM audio data and base64-encoded format, with
optional resampling capabilities.

The serializer is designed to work with the Pipecat audio processing pipeline and handles:
- Serialization of outgoing audio frames to base64
- Deserialization of incoming base64 data to audio frames
- Special handling for interruption events
"""

import os
import base64
import json
from typing import Optional
from pydantic import BaseModel
from loguru import logger
import numpy as np
import boto3
from dotenv import load_dotenv

from pipecat.frames.frames import (
    AudioRawFrame,
    Frame,
    InputAudioRawFrame,
    StartInterruptionFrame,
    StartFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer, FrameSerializer

load_dotenv(override=True)

class MessageType:
    """
    Message type constants for WebSocket communication.
    
    Attributes:
        MEDIA (str): Message containing audio data (base64-encoded PCM)
        USER_TRANSCRIPT (str): Message containing transcribed user speech
        BOT_TRANSCRIPT (str): Message containing bot response text
        INTERRUPTION (str): Message signaling an interruption event
    """
    MEDIA = "media"
    USER_TRANSCRIPT = "user_transcript"
    BOT_TRANSCRIPT = "bot_transcript"
    INTERRUPTION = "interruption"

class JsonSerializer(FrameSerializer):

    def __init__(self, sample_rate: int):
        """
        Initialize the serializer with configuration parameters.
        
        Args:
            frame (StartFrame): The initial frame containing setup information
        """
        self._sample_rate = sample_rate

    async def serialize(self, frame: Frame) -> str | None:
        """
        Convert a Pipecat frame into a JSON-formatted string for WebSocket transmission.
        
        Handles two main frame types:
        1. AudioRawFrame: Converts raw PCM audio data to base64 and wraps in JSON
        2. StartInterruptionFrame: Creates an interruption event message
        
        Args:
            frame (Frame): The frame to serialize. Can be AudioRawFrame, 
                          StartInterruptionFrame, or other frame types.
        
        Returns:
            str | None: JSON string containing the serialized frame data, or None if
                       the frame type is not handled or an error occurs.
        """
        try:
            if isinstance(frame, AudioRawFrame):
                # Encode raw PCM audio bytes to base64 for JSON-safe transmission
                audio_base64 = base64.b64encode(frame.audio).decode('utf-8')
                return json.dumps({
                    "event": MessageType.MEDIA,
                    "data": audio_base64
                })

            elif isinstance(frame, StartInterruptionFrame):
                return json.dumps({
                    "event": MessageType.INTERRUPTION,
                    "data": None
                })
                
            else:
                return None

        except Exception as e:
            logger.error(f"Error serializing frame: {e}")
            return None

    async def deserialize(self, data: str) -> Frame | None:
        """
        Convert a JSON-formatted WebSocket message into a Pipecat frame.
        
        Parses incoming JSON messages and converts base64-encoded audio data
        back into InputAudioRawFrame objects that can be processed by the
        audio pipeline.
        
        Args:
            data (str): JSON string containing the message to deserialize.
                       Expected format:
                       ```json
                       {
                           "event": "media",
                           "data": "base64_encoded_audio_data..."
                       }
                       ```
        
        Returns:
            Frame | None: InputAudioRawFrame containing the decoded audio data,
                         or None if the message type is not handled or an error occurs.
                         
        Note:
            The deserialized audio frame is configured as mono (1 channel) with
            the sample rate specified during setup. The audio data should be
            in raw PCM format after base64 decoding.
        """
        try:
            message = json.loads(data)
            if message["event"] == MessageType.MEDIA:
                # Decode base64 audio data back to raw PCM bytes
                audio_data = base64.b64decode(message["data"])
                
                return InputAudioRawFrame(
                    audio=audio_data,
                    num_channels=1,  # Mono audio
                    sample_rate=self._sample_rate
                )
            else:
                logger.warning(f'Unhandled message event: {message["event"]}')
                return None
            
        except Exception as e:
            logger.error(f"Error deserializing data: {e}")
            return None
