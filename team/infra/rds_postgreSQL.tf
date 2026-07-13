resource "aws_db_subnet_group" "db_subnet_group" {
  name = "app-db-subnet-group"

  subnet_ids = [
    aws_subnet.public_2a.id,
    aws_subnet.public_2c.id
  ]
}

resource "aws_db_instance" "postgres" {
  identifier        = "postgre"
  engine            = "postgres"
  engine_version    = "16.14"
  instance_class    = "db.t3.medium"
  allocated_storage = 30
  storage_type      = "gp3"

  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.db_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]

  multi_az            = false
  publicly_accessible = true
  skip_final_snapshot = true

  availability_zone = "ap-northeast-2a"

  parameter_group_name = aws_db_parameter_group.custom_pg.name
}


resource "aws_db_parameter_group" "custom_pg" {
  name   = "app-postgres-parameter"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }

  depends_on = [aws_iam_user_group_membership.infra_membership]
}

locals {
  db_migration_bucket = "shoply-postgresql2"
  db_migration_files  = ["01_schema.sql", "02_seed.sql"]
}

data "aws_s3_object" "db_migration_sql" {
  for_each = toset(local.db_migration_files)

  bucket = local.db_migration_bucket
  key    = each.value
}

resource "aws_ecs_cluster" "db_migration" {
  name = "app-db-migration"

  depends_on = [aws_iam_group_policy.infra_policy]
}


resource "aws_ecs_task_definition" "db_migration" {
  family                   = "app-db-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.db_migration_execution.arn

  container_definitions = jsonencode([
    {
      name      = "db-migration"
      image     = "postgres:16-alpine"
      essential = true
      command = [
        "sh",
        "-c",
        <<-EOT
        set -eu
        wget -q -O /tmp/01_schema.sql "$SCHEMA_URL"
        wget -q -O /tmp/02_seed.sql "$SEED_URL"
        export PGPASSWORD="$DB_PASSWORD"
        psql "host=$DB_HOST port=5432 dbname=$DB_NAME user=$DB_USER sslmode=prefer" -v ON_ERROR_STOP=1 -c "select current_database(), current_schema();"
        psql "host=$DB_HOST port=5432 dbname=$DB_NAME user=$DB_USER sslmode=prefer" -v ON_ERROR_STOP=1 -f /tmp/01_schema.sql
        psql "host=$DB_HOST port=5432 dbname=$DB_NAME user=$DB_USER sslmode=prefer" -v ON_ERROR_STOP=1 -f /tmp/02_seed.sql
        psql "host=$DB_HOST port=5432 dbname=$DB_NAME user=$DB_USER sslmode=prefer" -v ON_ERROR_STOP=1 -c "\dt"
        EOT
      ]
      environment = [
        { name = "DB_HOST", value = aws_db_instance.postgres.address },
        { name = "DB_NAME", value = "postgres" },
        { name = "DB_USER", value = var.db_username },
        { name = "DB_PASSWORD", value = var.db_password }
      ]
    }
  ])
}


resource "null_resource" "db_migration" {
  depends_on = [
    aws_db_instance.postgres,
    aws_ecs_task_definition.db_migration,
    aws_security_group_rule.ingress_postgres_from_rds_sg,
    aws_security_group_rule.rds_egress_all,
    aws_iam_role_policy_attachment.db_migration_execution,
    aws_iam_user_group_membership.infra_membership
  ]

  triggers = {
    db_endpoint        = aws_db_instance.postgres.address
    migration_revision = "2026-06-05-rerun-4"
    schema_etag        = data.aws_s3_object.db_migration_sql["01_schema.sql"].etag
    seed_etag          = data.aws_s3_object.db_migration_sql["02_seed.sql"].etag
  }

  provisioner "local-exec" {
    command     = <<EOT
    $ErrorActionPreference = "Stop"

    $schemaUrl = aws s3 presign "s3://${local.db_migration_bucket}/01_schema.sql" --expires-in 3600 --region ap-northeast-2
    $seedUrl = aws s3 presign "s3://${local.db_migration_bucket}/02_seed.sql" --expires-in 3600 --region ap-northeast-2

    $overrides = @{
      containerOverrides = @(
        @{
          name = "db-migration"
          environment = @(
            @{ name = "SCHEMA_URL"; value = $schemaUrl },
            @{ name = "SEED_URL"; value = $seedUrl }
          )
        }
      )
    } | ConvertTo-Json -Depth 6 -Compress
    $overridesPath = Join-Path $env:TEMP "db-migration-overrides.json"
    Set-Content -Path $overridesPath -Value $overrides -Encoding ascii

    $networkConfig = "awsvpcConfiguration={subnets=[${aws_subnet.public_2a.id},${aws_subnet.public_2c.id}],securityGroups=[${aws_security_group.rds_sg.id}],assignPublicIp=ENABLED}"

    $runTask = aws ecs run-task `
      --cluster "${aws_ecs_cluster.db_migration.name}" `
      --task-definition "${aws_ecs_task_definition.db_migration.arn}" `
      --launch-type FARGATE `
      --network-configuration $networkConfig `
      --overrides "file://$overridesPath" `
      --region ap-northeast-2 `
      --output json | ConvertFrom-Json

    if ($runTask.failures.Count -gt 0) {
      $runTask.failures | ConvertTo-Json -Depth 5
      exit 1
    }

    $taskArn = $runTask.tasks[0].taskArn
    if ([string]::IsNullOrWhiteSpace($taskArn)) {
      Write-Host "ECS run-task returned no taskArn."
      exit 1
    }

    Write-Host "Started DB migration task: $taskArn"
    aws ecs wait tasks-stopped --cluster "${aws_ecs_cluster.db_migration.name}" --tasks $taskArn --region ap-northeast-2

    $task = aws ecs describe-tasks `
      --cluster "${aws_ecs_cluster.db_migration.name}" `
      --tasks $taskArn `
      --region ap-northeast-2 `
      --output json | ConvertFrom-Json

    $container = $task.tasks[0].containers[0]
    Write-Host "DB migration exitCode: $($container.exitCode)"
    if ($container.reason) {
      Write-Host "DB migration reason: $($container.reason)"
    }

    if ($container.exitCode -ne 0) {
      exit 1
    }
    EOT
    interpreter = ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]
  }
}
