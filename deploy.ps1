# Deployment Script for Resource Monitor
# Run this script to prepare for deployment

Write-Host "🚀 Resource Monitor - Deployment Preparation" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "package.json")) {
    Write-Host "❌ Error: package.json not found. Please run this from the project root." -ForegroundColor Red
    exit 1
}

Write-Host "📦 Step 1: Building React application..." -ForegroundColor Yellow
Set-Location client
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}
Set-Location ..
Write-Host "✅ Build complete!" -ForegroundColor Green
Write-Host ""

Write-Host "📋 Step 2: Creating deployment package..." -ForegroundColor Yellow
$deployDir = "deploy-package"
if (Test-Path $deployDir) {
    Remove-Item $deployDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deployDir | Out-Null

# Copy necessary files
Copy-Item "server" -Destination "$deployDir/server" -Recurse
Copy-Item "client/build" -Destination "$deployDir/client/build" -Recurse
Copy-Item "package.json" -Destination "$deployDir/"
Copy-Item ".env.example" -Destination "$deployDir/"
Copy-Item "README.md" -Destination "$deployDir/"
Copy-Item ".gitignore" -Destination "$deployDir/"

# Create data directory
New-Item -ItemType Directory -Path "$deployDir/data" | Out-Null

Write-Host "✅ Package created in 'deploy-package' folder!" -ForegroundColor Green
Write-Host ""

Write-Host "📝 Step 3: Creating deployment instructions..." -ForegroundColor Yellow
$instructions = @'
# Deployment Instructions

## Quick Start on Remote Server

1. Copy the entire 'deploy-package' folder to your remote server
2. On the remote server, navigate to the folder
3. Run these commands:

### For Linux/Mac:
``````bash
npm install --production
cp .env.example .env
nano .env  # Edit configuration
npm start
``````

### For Windows:
``````powershell
npm install --production
Copy-Item .env.example .env
notepad .env  # Edit configuration
npm start
``````

4. Access the dashboard at http://your-server-ip:3001

## Keep It Running

### Using PM2 (Recommended):
``````bash
npm install -g pm2
pm2 start server/index.js --name resource-monitor
pm2 save
pm2 startup
``````

### As a Windows Service (using NSSM):
``````powershell
# Download NSSM from nssm.cc
nssm install ResourceMonitor "C:\Program Files\nodejs\node.exe"
nssm set ResourceMonitor AppDirectory "C:\path\to\deploy-package"
nssm set ResourceMonitor AppParameters "server\index.js"
nssm start ResourceMonitor
``````

## Firewall
Make sure port 3001 is open:
- Windows: Use Windows Firewall settings
- Linux: ``sudo ufw allow 3001/tcp``

## Configuration
Edit the .env file to configure:
- Email notifications
- Webhook notifications
- Port number
- Check intervals

Enjoy monitoring your resources! 🎉
'@

$instructions | Out-File -FilePath "$deployDir/DEPLOY.md" -Encoding UTF8
Write-Host "✅ Instructions created!" -ForegroundColor Green
Write-Host ""

Write-Host "🎉 Deployment package ready!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Transfer the 'deploy-package' folder to your remote computer"
Write-Host "2. Follow instructions in deploy-package/DEPLOY.md"
Write-Host ""
Write-Host "Transfer methods:" -ForegroundColor Yellow
Write-Host "- SCP: scp -r deploy-package user@remote:/path/to/destination"
Write-Host "- SFTP: Use WinSCP, FileZilla, or similar"
Write-Host "- Git: Push to repository and clone on remote"
Write-Host "- USB: Copy folder to USB drive"
Write-Host ""
