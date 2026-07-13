resource "aws_instance" "redis" {
  ami                         = data.aws_ssm_parameter.instance_ubuntu_ami.value
  instance_type               = "t2.small"
  key_name                    = var.key_name

  subnet_id                   = aws_subnet.public_2a.id
  vpc_security_group_ids      = [aws_security_group.redis_sg.id]
  
  private_ip                  = "10.0.1.141"

  user_data = base64encode(<<-EOF
    #!/bin/bash
    exec > /var/log/user-data.log 2>&1
    set -e

    apt-get update -y

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    systemctl enable docker && systemctl start docker
    usermod -aG docker ubuntu

    mkdir -p /home/ubuntu/redis
    chown -R ubuntu:ubuntu /home/ubuntu/redis

    systemctl stop redis-server || true
    systemctl disable redis-server || true
    docker rm -f redis-server || true

    docker run -d --name redis-server --restart always -p 6379:6379 -v /home/ubuntu/redis:/data redis:latest --appendonly yes

    echo "Redis EC2 User Data 완료: $(date)"
  EOF
  )

  tags = { Name = "app-redis" }
}
