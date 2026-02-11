# SafeHerHub Backend - Vercel Deployment Guide

## Deployment Error Fix - February 12, 2026

### Issue Encountered
```
Invalid export found in module "/var/task/server.js". 
The default export must be a function or server.
```

### Root Cause
Vercel's serverless environment requires the module to export a function or Express app directly, not an object literal.

### Solution Implemented

1. **Modified Export in `server.js`**
   - Changed from: `module.exports = { app, io };`
   - Changed to: `module.exports = server;`
   - Now respects development vs production environments

2. **Created `vercel.json` Configuration**
   - Specifies Node.js runtime
   - Routes all requests through the API handler
   - Configures environment variables

3. **Created Serverless Handler Structure**
   - New `api/index.js` - Proper serverless function
   - Exports Express app for Vercel's Node runtime
   - Removed Socket.io from serverless (limitation)

## Environment Configuration

Add these to Vercel Environment Variables:
```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
CLIENT_URL=your_frontend_url
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_email_password
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

## Deployment Steps

1. Push code to GitHub
   ```bash
   git add .
   git commit -m "Fix Vercel deployment"
   git push origin main
   ```

2. In Vercel Dashboard:
   - Connect GitHub repository
   - Set environment variables
   - Deploy

3. Verify Deployment:
   ```bash
   curl https://your-deployment.vercel.app/api/health
   ```

## Local Development

Server still listens on port 5000 in development:
```bash
cd server
npm start
```

## Production vs Development

- **Development**: Full server with Socket.io
- **Production (Vercel)**: REST API only (Socket.io not supported in serverless)

## Troubleshooting

### Still getting module error?
- Clear Vercel cache and redeploy
- Verify `api/index.js` exports the app correctly
- Check `vercel.json` is in server root

### MongoDB connection fails?
- Verify MONGODB_URI in environment variables
- Check IP whitelist in MongoDB Atlas
- Ensure connection string is correct

### CORS errors?
- Verify CLIENT_URL in environment variables
- Check CORS configuration matches your frontend domain

## Notes

- Socket.io functionality limited in serverless (consider Redis adapter for production)
- Consider using Vercel's PostgreSQL for better serverless support
- API response time may increase due to cold starts initially
