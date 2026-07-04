#!/bin/bash
exec > /var/log/user-data.log 2>&1
set -e

apt-get update -y

# Docker 설치
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable docker && systemctl start docker
usermod -aG docker ubuntu

# 작업 디렉토리 생성
mkdir -p /home/ubuntu/redis
chown -R ubuntu:ubuntu /home/ubuntu/redis

echo "Redis EC2 User Data 완료: $(date)"