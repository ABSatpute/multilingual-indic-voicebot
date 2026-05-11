# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import asyncio
import re
import json
import sys
from datetime import datetime
from loguru import logger
from dotenv import load_dotenv
import boto3
import aiohttp
import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pipecat.audio.vad.silero import SileroVADAnalyzer, VADParams
from pipecat.frames.frames import TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.text_transformer import StatelessTextTransformer
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)
from pipecat.transcriptions.language import Language
from pipecat.services.aws.llm import AWSBedrockLLMService
# from pipecat.services.aws.nova_sonic.llm import AWSNovaSonicLLMService, Params
from patch.llm import AWSNovaSonicLLMService, Params
from pipecat.services.aws.tts import AWSPollyTTSService
from pipecat.services.aws.stt import AWSTranscribeSTTService
from pipecat.frames.frames import Frame, LLMRunFrame, TextFrame, LLMTextFrame, LLMFullResponseStartFrame, LLMFullResponseEndFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.strands_agents import StrandsAgentsProcessor
from pipecat.processors.transcript_processor import TranscriptProcessor
from pipecat.services.llm_service import FunctionCallParams
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from mcp.client.session_group import StreamableHttpParameters
from mcp.client.streamable_http import streamablehttp_client
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService, ElevenLabsSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from strands import Agent, tool
from strands.experimental.hooks import BeforeToolInvocationEvent
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.observers.loggers.llm_log_observer import LLMLogObserver
from typing import Callable, Any
from functools import wraps
import inspect

from JsonSerializer import JsonSerializer
from utils import validate_websocket_auth, update_dredentials
from usecase import system_prompt, get_tools

load_dotenv(override=True)
USER_POOL_ID =  os.environ["USER_POOL_ID"]
APP_CLIENT_ID =  os.environ["APP_CLIENT_ID"]
REGION = os.environ["AWS_DEFAULT_REGION"]
LLM_MODEL = os.environ["LLM_MODEL"]

SAMPLE_RATE = 16000

LANGUAGE_GREETINGS = {
    'english': "Hello! How can I help you today?",
    'hindi': "नमस्ते! मैं आज आपकी कैसे मदद कर सकता हूँ?",
    'bengali': "নমস্কার! আমি আজ আপনাকে কীভাবে সাহায্য করতে পারি?",
    'gujarati': "નમસ્તે! હું આજે તમારી કેવી રીતે મદદ કરી શકું?",
    'kannada': "ನಮಸ್ಕಾರ! ನಾನು ಇಂದು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?",
    'malayalam': "നമസ്കാരം! ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?",
    'marathi': "नमस्कार! मी आज तुम्हाला कशी मदत करू शकतो?",
    'tamil': "வணக்கம்! இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?",
    'telugu': "నమస్కారం! ఈ రోజు నేను మీకు ఎలా సహాయం చేయగలను?",
    'odia': "ନମସ୍କାର! ଆଜି ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?",
    'punjabi': "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਅੱਜ ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ?",
    'assamese': "নমস্কাৰ! আজি মই আপোনাক কেনেকৈ সহায় কৰিব পাৰোঁ?",
}

secrets_client = boto3.client(service_name='secretsmanager',region_name=os.getenv('AWS_DEFAULT_REGION'))
SARVAM_API_KEY = secrets_client.get_secret_value(SecretId=os.environ["SARVAM_API_KEY"])['SecretString']

def map_language_string_to_enum(language: str) -> Language:
    language_map = {
        'english': Language.EN,
        'hindi': Language.HI,
        'bengali': Language.BN,
        'gujarati': Language.GU,
        'kannada': Language.KN,
        'malayalam': Language.ML,
        'marathi': Language.MR,
        'tamil': Language.TA,
        'telugu': Language.TE,
        'odia': Language.OR,
        'punjabi': Language.PA,
        'assamese': Language.AS
    }
    
    mapped_language = language_map.get(language, Language.EN)
    
    logger.info(f"Mapped language '{language}' to {mapped_language}")
    return mapped_language

def get_voice_id_for_service(service_name: str, language: Language) -> str:
    VOICE_MAPS = {
        'transcribe-polly': {
            Language.EN: 'Danielle',  # English (US) - Neural voice
            Language.HI: 'Kajal',     # Hindi (India) - Neural voice
        },
        'sarvam': {
            Language.EN: 'anand',
            Language.HI: 'anand',
            Language.BN: 'anand',
            Language.GU: 'anand',
            Language.KN: 'anand',
            Language.MR: 'anand',
            Language.TA: 'anand',
            Language.TE: 'anand',
            Language.OR: 'anand',
            Language.PA: 'anand',
            Language.AS: 'anand',
        },
        'novasonic': {
            Language.EN: 'tiffany',  # English (US) - Neural voice
            Language.HI: 'kiara',     # Hindi (India) - Neural voice
        },
    }
    
    service_voice_map = VOICE_MAPS.get(service_name.lower(), {})
    voice_id = service_voice_map.get(language, service_voice_map.get(Language.EN))
    
    logger.info(f"Selected voice '{voice_id}' for service '{service_name}' with language '{language}'")
    return voice_id

def create_strands_tools(tools) -> list:
    strands_tools = []
    
    for curr_tool in tools:
        @tool
        @wraps(curr_tool)
        async def strands_wrapper(*args, _method=curr_tool, **kwargs):
            return await _method(*args, **kwargs)
        
        strands_wrapper.__name__ = curr_tool.__name__
        strands_wrapper.__doc__ = curr_tool.__doc__
        strands_wrapper.__annotations__ = {
            k: v for k, v in curr_tool.__annotations__.items() 
            if k != 'return'
        }
        
        strands_tools.append(strands_wrapper)
    
    return strands_tools


def create_pipecat_tools(tools) -> list:
    pipecat_tools = []
    
    for tool in tools:
        sig = inspect.signature(tool)
        param_names = [p.name for p in sig.parameters.values()]
        param_str = ', '.join(param_names)
        
        wrapper_code = f'''
async def {tool.__name__}(params: FunctionCallParams, {param_str}):
    """{tool.__doc__ or ''}"""
    result = await _method({param_str})
    await params.result_callback(result)
'''
        local_ns = {'FunctionCallParams': FunctionCallParams, '_method': tool}
        exec(wrapper_code, local_ns)
        pipecat_wrapper = local_ns[tool.__name__]
        
        original_annotations = {
            k: v for k, v in tool.__annotations__.items() 
            if k != 'return'
        }
        pipecat_wrapper.__annotations__ = {
            'params': FunctionCallParams,
            **original_annotations
        }
        
        pipecat_tools.append(pipecat_wrapper)
    
    return pipecat_tools

class TextTransformer(FrameProcessor):    
    def __init__(self):
        super().__init__()
        self.response = ''
        self.muted = False

    def clean_thinking_tags(self, text: str) -> str:
        pattern = r'<thinking>(?:[^<]|<(?!thinking>))*?</thinking>'
        prev_text = None
        cleaned_text = text
        
        while prev_text != cleaned_text:
            prev_text = cleaned_text
            cleaned_text = re.sub(pattern, '', cleaned_text, flags=re.DOTALL | re.IGNORECASE)
        
        # Handle malformed thinking tags (missing closing tags)
        cleaned_text = re.sub(r'<thinking>(?:[^<]|<(?!thinking>))*?(?=<thinking>|$)', '', cleaned_text, flags=re.DOTALL | re.IGNORECASE)
        
        # Handle malformed thinking tags (missing opening tags)
        cleaned_text = re.sub(r'</thinking>', '', cleaned_text, flags=re.IGNORECASE)
        
        return cleaned_text.strip()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            self.response = ''

        elif isinstance(frame, LLMFullResponseEndFrame):
            cleaned_response = self.clean_thinking_tags(self.response)
            logger.debug(f"Original response: {self.response}")
            logger.debug(f"Cleaned response: {cleaned_response}")

            await self.push_frame(LLMTextFrame(text=cleaned_response), direction)

        elif isinstance(frame, LLMTextFrame):
            self.response += frame.text
            return

        await self.push_frame(frame, direction)


async def create_stt_tts_services(pipeline, language):
    language = map_language_string_to_enum(language)
    voice_id = get_voice_id_for_service(pipeline, language)

    if pipeline.lower() == "transcribe-polly":
        stt = AWSTranscribeSTTService(
            secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            session_token=os.getenv("AWS_SESSION_TOKEN"),
            region=REGION,
            language=language,
            sample_rate=SAMPLE_RATE
        )
        tts = AWSPollyTTSService(
            secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            session_token=os.getenv("AWS_SESSION_TOKEN"),
            region=REGION,
            voice_id=voice_id,
            sample_rate=SAMPLE_RATE,
            params=AWSPollyTTSService.InputParams(
                engine="neural",
                language=language
            )
        )

    elif pipeline.lower() == "sarvam":
        # Map Language enum to Sarvam language code
        sarvam_language_map = {
            Language.EN: "en-IN",
            Language.HI: "hi-IN",
            Language.BN: "bn-IN",
            Language.GU: "gu-IN",
            Language.KN: "kn-IN",
            Language.ML: "ml-IN",
            Language.MR: "mr-IN",
            Language.TA: "ta-IN",
            Language.TE: "te-IN",
            Language.OR: "od-IN",
            Language.PA: "pa-IN",
            Language.AS: "as-IN",
        }
        sarvam_lang = sarvam_language_map.get(language, "unknown")

        stt = SarvamSTTService(
            api_key=SARVAM_API_KEY,
            language=sarvam_lang,
            model="saaras:v3"
        )
        tts = SarvamTTSService(
            api_key=SARVAM_API_KEY,
            target_language_code=sarvam_lang,
            model="bulbul:v3",
            speaker=voice_id
        )
      
    else:
        raise ValueError(f"Unsupported pipeline vendor:")

    return (stt, tts)

class ToolCallInterceptor(FrameProcessor):
    def __init__(self, agent, context_aggregator):
        super().__init__()
        self.context_aggregator = context_aggregator
        self.agent = agent
        agent.hooks.add_callback(BeforeToolInvocationEvent, self.my_callback)

    def my_callback(self, event: BeforeToolInvocationEvent) -> None:
        logger.info(f"Custom callback triggered for tool")

        tool_input = event.tool_use.get("input", {})        
        waiting_message = tool_input.get("waiting_message")
        
        if waiting_message:
            asyncio.create_task(self.send_message(waiting_message))
        else:
            logger.warning(f"No waiting_message found in tool input")
        
    async def send_message(self, message: str):
        await self.push_frame(LLMFullResponseStartFrame())
        await self.push_frame(LLMTextFrame(text=message))
        await self.push_frame(LLMFullResponseEndFrame())

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)

async def run_bot(websocket_client, pipeline, language):
    update_dredentials()
    
    transport = FastAPIWebsocketTransport(
        websocket=websocket_client,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_in_sample_rate=SAMPLE_RATE,
            audio_out_enabled=True,
            audio_out_sample_rate=SAMPLE_RATE,
            add_wav_header=False,
            vad_analyzer=SileroVADAnalyzer(params = VADParams(
                min_volume=0.65
            )),
            serializer=JsonSerializer(SAMPLE_RATE),
        ),
    )

    if pipeline == 'novasonic':
        sonic_params = Params()
        sonic_params.input_sample_rate = SAMPLE_RATE
        sonic_params.output_sample_rate = SAMPLE_RATE

        llm = AWSNovaSonicLLMService(
            secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            session_token=os.getenv("AWS_SESSION_TOKEN"),
            region="us-east-1",
            voice_id="kiara",
            system_instruction=system_prompt,
            params = sonic_params,
        )

        tools = create_pipecat_tools(get_tools())
        for tool_func in tools:
            llm.register_direct_function(tool_func, cancel_on_interruption=True)

        context = LLMContext(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Hello !"},
            ],
            tools= ToolsSchema(standard_tools=tools)
        )
        context_aggregator = LLMContextAggregatorPair(context)

        task_pipeline = Pipeline(
            [
                transport.input(),
                context_aggregator.user(),
                llm,
                transport.output(),
                context_aggregator.assistant(),
            ]
        )
    
    else:
        stt, tts = await create_stt_tts_services(pipeline, language)
        
        agent = Agent(
            system_prompt=system_prompt,
            model=LLM_MODEL,
            tools=create_strands_tools(get_tools())
        )
        
        context = LLMContext(
            messages=[
                {"role": "user", "content": "Hello !"}
            ]
        )
        context_aggregator = LLMContextAggregatorPair(context)
        
        task_pipeline = Pipeline(
            [
                transport.input(),
                stt,
                context_aggregator.user(),
                StrandsAgentsProcessor(agent),
                TextTransformer(),
                ToolCallInterceptor(agent, context_aggregator),
                tts,
                transport.output(),
                context_aggregator.assistant(),
            ]
        )

    task = PipelineTask(
        task_pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
            audio_in_sample_rate=SAMPLE_RATE,
            audio_out_sample_rate=SAMPLE_RATE,
            observers=[LLMLogObserver()],
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"Nova sonic Client connected - waiting for user to speak")
        greeting = LANGUAGE_GREETINGS.get(language, LANGUAGE_GREETINGS['english'])
        await task.queue_frames([LLMRunFrame() if pipeline == 'novasonic' else TTSSpeakFrame(greeting)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Pipecat Client disconnected")
        await task.cancel()

    @transport.event_handler("on_session_timeout")
    async def on_session_timeout(transport, client):
        logger.info(f"Entering in timeout for {client.remote_address}")
        await task.cancel()

    @task.event_handler("on_pipeline_error")
    async def on_pipeline_error(task, frame):
        logger.error("INSIDE PIPELINE ERROR CALLBACK")
        
    runner = PipelineRunner(handle_sigint=False, force_gc=True)
    await runner.run(task)
    logger.info("After RUN TASK: Pipeline completed")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"message": "OK\n"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    if not validate_websocket_auth(websocket.query_params):
        logger.error(f"Authentication failed.")
        await websocket.close(code=403)
        return

    await websocket.accept()
    logger.info(f"WebSocket connection accepted")
    
    try:
        pipeline = websocket.query_params.get("pipeline")
        language = websocket.query_params.get("language")
        await run_bot(websocket, pipeline, language)
    except Exception as e:
        logger.exception(f"CRITICAL: Exception in run_bot: {e}", exc_info=True)
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except Exception as close_error:
            logger.exception(f"Error closing websocket: {close_error}")
    finally:
        logger.info(f"WebSocket connection closed.")

async def main():
    logger.info("App starting")
    config = uvicorn.Config(app, host="0.0.0.0", port=8080)
    server = uvicorn.Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(main())
