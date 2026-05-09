# AWS Account Setup — A2 Complete

## IAM User Created
- Username: `dev-indic-user`
- Policy: `AdministratorAccess`
- AWS Account ID: `417780655467`
- CLI Profile: `vomyra` (configured via `aws configure --profile vomyra`)
- Region: `ap-south-1`

## Billing Alert Created
- Budget: $20/month
- Alert threshold: 80%
- Configured from root account

## Security Rules
- Root account: used only for billing and IAM setup
- All CLI and CDK commands use: `--profile vomyra`
- Access keys: never committed to git, never shared in chat

## Verify anytime
```bash
aws sts get-caller-identity --profile vomyra
```

## Next Step
A3 — Enable Bedrock model access and create Knowledge Base in AWS Console.
