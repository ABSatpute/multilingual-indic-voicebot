# Environment Setup — A1 Complete

## Verified Tool Versions

| Tool | Version | Status |
|---|---|---|
| AWS CLI | 2.34.45 | ✅ |
| Node.js | 22.22.2 | ✅ |
| AWS CDK | 2.1121.0 | ✅ |
| Python | 3.x | ✅ |
| Docker | installed | ✅ |

## OS
- Windows 11 with WSL2 (Ubuntu 24.04)
- All commands run inside WSL terminal

## Installation Commands Used

```bash
# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# AWS CDK
sudo npm install -g aws-cdk

# Python and Docker
sudo apt install python3 python3-pip python3-venv docker.io -y
sudo usermod -aG docker $USER
```

## Next Step
A2 — Create IAM user and billing alert in AWS Console.
