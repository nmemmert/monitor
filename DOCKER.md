# Docker Setup for SkyWatch

This guide explains how to build and run SkyWatch using Docker.

## Prerequisites

- Docker and Docker Compose installed on your system
- A `.env` file configured in the project root (see README.md for configuration details)

## Building Locally

### Using Docker Compose (Recommended)

The easiest way to build and run SkyWatch with Docker:

```bash
docker-compose up -d
```

This will:
1. Build the Docker image
2. Create a container named `skywatch-monitor`
3. Start the application on port 3001
4. Mount a persistent volume for data storage

### Using Docker Directly

To build the image manually:

```bash
docker build -t skywatch:latest .
```

To run the container:

```bash
docker run -d \
  --name skywatch \
  -p 3001:3001 \
  --env-file .env \
  -v skywatch-data:/app/data \
  skywatch:latest
```

## Pushing to GitHub Container Registry (GHCR)

### Automatic Deployment (Recommended)

The project includes a GitHub Actions workflow (`.github/workflows/docker-publish.yml`) that automatically:
- Builds your Docker image when you push to `main` or create a tag
- Pushes it to GitHub Container Registry (GHCR)
- Tags images as:
  - `latest` (for main branch)
  - Branch name (e.g., `main`)
  - Semantic version (if you push a tag like `v1.0.0`)
  - Short commit SHA

**No configuration needed!** The workflow uses GitHub's built-in authentication.

### Manual Push to GHCR

If you want to push manually:

1. Authenticate with GitHub Container Registry:
```bash
echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u USERNAME --password-stdin
# Or use a Personal Access Token (PAT) with `read:packages` and `write:packages` scopes
```

2. Build and tag the image:
```bash
docker build -t ghcr.io/YOUR-USERNAME/monitor:latest .
```

3. Push to GHCR:
```bash
docker push ghcr.io/YOUR-USERNAME/monitor:latest
```

## Viewing Published Images

Visit: `https://github.com/nmemmert/monitor/pkgs/container/monitor`

Or pull the image:
```bash
docker pull ghcr.io/nmemmert/monitor:latest
```

## Managing Containers

### View running containers
```bash
docker ps
```

### View logs
```bash
docker logs skywatch-monitor
# Follow logs in real-time
docker logs -f skywatch-monitor
```

### Stop the container
```bash
docker-compose down
# Or
docker stop skywatch-monitor
```

### Remove containers and volumes
```bash
docker-compose down -v
```

## Environment Variables

Make sure your `.env` file is in the project root with required variables:

```env
PORT=3001
NODE_ENV=production
# Add other environment variables as needed
```

The `.env` file is loaded by Docker Compose from the `env_file` directive.

## Health Checks

The Docker container includes a health check that verifies the API is responding:

```bash
docker inspect skywatch-monitor --format='{{.State.Health.Status}}'
```

## Troubleshooting

### Container exits immediately
Check logs:
```bash
docker logs skywatch-monitor
```

### Port already in use
Change the port in `docker-compose.yml`:
```yaml
ports:
  - "3002:3001"  # Access at localhost:3002
```

### Database issues
Clear the volume and rebuild:
```bash
docker-compose down -v
docker-compose up -d
```

### Permission issues
The container runs as non-root user (nodejs). Ensure `.env` file permissions allow reading.

## Production Deployment

For production environments, consider:

1. Using a reverse proxy (nginx, traefik)
2. Setting up SSL/TLS certificates
3. Using environment-specific `.env` files
4. Implementing container orchestration (Kubernetes, Docker Swarm)
5. Setting resource limits in docker-compose.yml:

```yaml
services:
  skywatch:
    # ... other config
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```
