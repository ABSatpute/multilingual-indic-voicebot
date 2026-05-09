# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import boto3
import json
from loguru import logger
from typing import List, Dict
from pipecat.services.llm_service import FunctionCallParams
from strands import tool

from utils import update_dredentials

session = boto3.Session()
bedrock_agent_runtime = session.client('bedrock-agent-runtime')

KNOWLEDGE_BASE_ID = os.environ["KNOWLEDGE_BASE_ID"]

system_prompt = """
You are a helpful female assistant engaged in a natural real-time voice conversation. 
Keep your responses short, generally two or three sentences for chatty scenarios.
Your goal is to demonstrate your capabilities in a succinct way.
Your output will be converted to audio so don't include special characters in your answers.

User might say numbers and IDs in different ways. You have to identify and use them properly. For example the Number/ID 892113 can be said by the user as any of the folllowing:
eigthtnine twenty one thirteen
Eight lakh ninety-two thousand one hundred thirteen
Eight hundred ninety-two thousand one hundred thirteen
Eight nine two one one three
Eighty-nine twenty-one thirteen
Aath lakh baanve hazaar ek sau terah
आठ लाख बानवे हज़ार एक सौ तेरह

EXTREMELY IMPORTANT: 
1. You can always check current date and time with the given tool. 
2. You must detect the language from the last user message and respond back in the same language only.
3. DO NOT answer questions not related to the employee, exployment and the company.
4. Choose words suitable a natural conversation which may mix English along with the primary language in use.
"""

@tool
async def policy_lookup(waiting_message:str, query: str) -> List[Dict]:
    """
    This tool can lookup company policy related information. If the retrieved data is not identical to what the user asked, you can ask for clarifications to the user.

    Arguments:
        waiting_message: A dynamic, short contextual non-repeating waiting message for the user. Come up with a different message each time.
        query: The query to lookup against

    Returns:
        The retrived responses
    """
    try:
        update_dredentials()

        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            retrievalQuery={
                'text': query
            },
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': 3
                }
            }
        )
        logger.debug(f'response: {response}')
        
        results = []
        for result in response.get('retrievalResults', []):
            doc_info = {
                'content': result.get('content', {}).get('text', ''),
                'score': result.get('score', 0.0),
                'location': result.get('location', {}),
                'metadata': result.get('metadata', {})
            }
            results.append(doc_info)

        logger.debug(f'results: {results}')
    except Exception as error:
        logger.exception(f"Error: {error}")
    
    return {"results": results}

@tool
async def get_leave_balance(type: str) -> int | str:
    """
    This tool can retrieve the leave balance for a given leave type. Type is one of the following.
    1. casual
    2. sick

    Arguments:
        type: Type of leave for which the leave balance is to be retrieved

    Returns:
        The leave balance for the given leave type, or a message of something went wrong.
    """
    if type.lower() == 'casual':
        return {"balance": 5}
    elif type.lower() == 'sick':
        return {"balance": 10}
    else:
        return f"{type} is not a valid type of leave."

def get_tools(): 
    return [
        get_leave_balance,
        policy_lookup
    ]
