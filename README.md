# indicvoice

Real-time multilingual voice AI assistant supporting English, Hindi, and 8 Indian regional languages — built on AWS Bedrock, ECS Fargate, and RAG Knowledge Base.

## Architecture

```
Browser (React)
    │  WebSocket (audio stream)
    ▼
CloudFront → ALB
    │  host-based routing
    ▼
ECS Fargate (FastAPI + Pipecat)
    ├── Nova Sonic 2  →  English / Hindi  (speech-to-speech)
    └── Sarvam AI STT → Nova Pro LLM → Sarvam TTS  (8 regional languages)
              │
              ▼
    Bedrock Knowledge Base (RAG)
              │
              ▼
         S3 (documents)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Voice pipeline | [Pipecat](https://github.com/pipecat-ai/pipecat) + FastAPI |
| Speech-to-speech | Amazon Bedrock Nova Sonic 2 |
| LLM | Amazon Bedrock Nova Pro / Nova Lite |
| STT / TTS (Indic) | [Smallest.ai](https://smallest.ai) |
| RAG | Amazon Bedrock Knowledge Base + Titan Embeddings V2 |
| Frontend | React + WebSocket + AudioWorklet |
| Auth | Amazon Cognito |
| Infrastructure | AWS CDK (Python) |
| Compute | ECS Fargate |
| CDN | CloudFront + S3 |

## Supported Languages

English · Hindi · Bengali · Tamil · Telugu · Kannada · Malayalam · Marathi · Gujarati · Odia · Punjabi · Assamese

## Prerequisites

- AWS account with admin IAM user (not root)
- Python 3.12+
- Node.js 22+
- AWS CDK (`npm install -g aws-cdk`)
- Docker
- [Smallest.ai](https://smallest.ai) API key

## Setup

### 1. AWS Console (one-time)

- Enable Bedrock model access in `ap-south-1`: Nova Lite, Nova Pro, Nova Micro, Titan Embeddings V2
- Create S3 bucket and upload your documents
- Create Bedrock Knowledge Base → note the **Knowledge Base ID**
- Store Smallest.ai key in Secrets Manager:

```bash
aws secretsmanager create-secret \
    --name "smallest_key" \
    --secret-string "sk_your_key_here" \
    --region ap-south-1 \
    --profile your-profile
```

### 2. Configure

```bash
cp backend/.env.example backend/.env
# Fill in: KNOWLEDGE_BASE_ID, USER_POOL_ID, APP_CLIENT_ID
```

Edit `infra/cdk.json`:
```json
{
  "context": {
    "knowledgebase": "YOUR_KB_ID",
    "llm_model": "apac.amazon.nova-lite-v1:0",
    "secret_name": "smallest_key"
  }
}
```

### 3. Deploy

```bash
cd frontend && npm install && cd ..
cd infra
pip install -r requirements.txt
cdk bootstrap --profile your-profile
cdk deploy --profile your-profile
```

### 4. Create a user

```bash
aws cognito-idp admin-create-user \
    --user-pool-id YOUR_POOL_ID \
    --username your@email.com \
    --temporary-password "Temp@1234" \
    --region ap-south-1 \
    --profile your-profile
```

Open the CloudFront URL → login → select language → speak.

### 5. Tear down (stop all charges)

```bash
cd infra && cdk destroy --profile your-profile
```

## Project Structure

```
indicvoice/
├── backend/
│   ├── main.py          # FastAPI + Pipecat pipeline
│   ├── usecase.py       # System prompt + RAG tool (customize here)
│   ├── utils.py         # Cognito auth validation
│   ├── patch/llm.py     # Nova Sonic 2 patch
│   ├── vendors/         # Smallest.ai STT/TTS integrations
│   ├── .env.example     # Environment variable template
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Main app + language selector
│   │   ├── audio.js     # WebSocket audio streaming
│   │   └── Hologram.jsx # 3D avatar visualization
│   └── package.json
└── infra/
    ├── infra_stack.py   # All AWS infrastructure (VPC, ECS, ALB, Cognito)
    ├── vpc_construct.py
    ├── app.py
    └── cdk.json         # KB ID, model, secret name
```

## Customizing the Bot

Edit `backend/usecase.py` to change:
- `system_prompt` — bot personality and instructions
- `policy_lookup` tool — RAG query logic
- Add new tools using the `@tool` decorator (Strands Agents)

Redeploy after changes: `cdk deploy --profile your-profile`

## Cost Estimate

| Mode | Cost |
|---|---|
| Destroyed (not running) | ~$0.50/month (S3 + Secrets Manager only) |
| Running (learning) | ~$1.50/day |
| Always-on hosted | ~$30/month (with NAT Gateway removed) |

## License

MIT-0 — See [LICENSE](LICENSE)
