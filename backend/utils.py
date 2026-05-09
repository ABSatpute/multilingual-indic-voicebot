# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
from loguru import logger
import jwt
import json
import requests

USER_POOL_ID =  os.environ["USER_POOL_ID"]
APP_CLIENT_ID =  os.environ["APP_CLIENT_ID"]
REGION = os.environ["AWS_DEFAULT_REGION"]

def validate_websocket_auth(query_params: dict) -> bool:
    id_token = query_params.get("token")
    if id_token:
        try:
            jwks_url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
            jwks_client = jwt.PyJWKClient(jwks_url)

            signing_key = jwks_client.get_signing_key_from_jwt(id_token)
            verified_claims = jwt.decode(
                id_token,
                signing_key.key,
                algorithms=["RS256"],
                audience=APP_CLIENT_ID,
                issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
            )

            logger.info("Frontend connection authenticated via Cognito JWT: " + json.dumps(verified_claims))
            return True

        except Exception as e:
            logger.info("Frontend connection rejected for Cognito JWT")
            logger.error(e)
            return False
    
    logger.error("No authentication credentials provided.")
    return False

def update_dredentials():
    """
    Updates AWS credentials by fetching from ECS container metadata endpoint.
    Used in containerized environments to maintain fresh credentials.
    """
    try:
        uri = os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        if uri:
            print("Fetching fresh AWS credentials for Bedrock client", flush=True)
            response = requests.get(f"http://169.254.170.2{uri}")
            if response.status_code == 200:
                creds = response.json()
                os.environ["AWS_ACCESS_KEY_ID"] = creds["AccessKeyId"]
                os.environ["AWS_SECRET_ACCESS_KEY"] = creds["SecretAccessKey"]
                os.environ["AWS_SESSION_TOKEN"] = creds["Token"]
                print("AWS credentials refreshed successfully", flush=True)
            else:
                print(f"Failed to fetch fresh credentials: {response.status_code}", flush=True)
    except Exception as e:
        print(f"Error refreshing credentials: {str(e)}", flush=True)