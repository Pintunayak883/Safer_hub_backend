# SafeHerHub - Server (Backend)

This is the Node.js/Express backend for SafeHerHub, a comprehensive women's safety platform.

## 📋 Prerequisites

- Node.js v14 or higher
- npm v6 or higher
- MongoDB (local or cloud instance)

## 🚀 Installation

```bash
cd server
npm install
```

## ⚙️ Environment Setup

Create a `.env` file in the server directory with the following variables:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/safeherhub
JWT_SECRET=your_jwt_secret_key_here
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
CLIENT_URL=http://localhost:3000
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_email_password
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
K_ANON=3
TILE_SIZE_M=50
AGG_WINDOW_DAYS=30
RETENTION_DAYS=30
```

## 🏃 Running the Server

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will run on `http://localhost:5000`

## 📦 Project Structure

```
server/
├── config/             # Configuration files
│   └── passport.js     # Authentication configuration
├── middleware/         # Express middleware
│   ├── auth.js        # Authentication middleware
│   └── privacy.js     # Privacy middleware
├── models/            # MongoDB schemas
│   ├── User.js
│   ├── Report.js
│   ├── Alert.js
│   ├── Forum.js
│   ├── Guardian.js
│   └── Pulse.js
├── routes/            # API routes
│   ├── auth.js        # Authentication endpoints
│   ├── users.js       # User endpoints
│   ├── reports.js     # Report endpoints
│   ├── forums.js      # Forum endpoints
│   ├── alerts.js      # Alert endpoints
│   ├── guardians.js   # Guardian endpoints
│   └── pulse.js       # Pulse check endpoints
├── scripts/           # Utility scripts
│   ├── seed_heatmap_demo.js
│   ├── seed_routes_synthetic.js
│   └── seedDemo.js
├── utils/             # Utility functions
│   └── geo.js         # Geolocation utilities
├── server.js          # Main server file
└── .env               # Environment variables
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/google` - Google OAuth login

### Users
- `GET /api/users/:id` - Get user profile
- `PUT /api/users/:id` - Update user profile
- `GET /api/users` - List users (admin)

### Reports
- `POST /api/reports` - Create incident report
- `GET /api/reports` - Get reports
- `PUT /api/reports/:id` - Update report

### Forums
- `GET /api/forums` - Get forums
- `POST /api/forums` - Create forum
- `POST /api/forums/:id/messages` - Post message

### Alerts
- `POST /api/alerts` - Create alert
- `GET /api/alerts` - Get alerts
- `PUT /api/alerts/:id` - Update alert

### Guardians
- `POST /api/guardians` - Add guardian
- `GET /api/guardians` - Get guardians
- `DELETE /api/guardians/:id` - Remove guardian

### Pulse Checks
- `POST /api/pulse` - Create pulse check
- `GET /api/pulse` - Get pulse checks
- `POST /api/pulse/:id/response` - Respond to pulse

## 📊 Database Models

### User
- Email, name, phone
- Password (hashed with bcrypt)
- Location data
- Emergency contacts
- Preferences

### Report
- Incident details and location
- Severity level
- Photos/attachments
- Status tracking

### Alert
- Alert type (whisper, SOS, etc.)
- Recipients
- Location
- Timestamp

### Forum
- Topic and description
- Messages and threads
- Member participation

### Guardian
- Trusted contact info
- Relationship type
- Permissions

### Pulse
- Check-in status
- Trusted contacts
- Response tracking

## 🔒 Security Features

- JWT token-based authentication
- Password hashing with bcrypt
- CORS configured for frontend
- Rate limiting enabled
- Helmet.js for HTTP headers
- Input validation with express-validator
- Passport.js integration for OAuth

## 🔧 Scripts

- `npm start` - Run production server
- `npm run dev` - Run with nodemon (auto-reload)
- Uses `concurrently` for development

## 📚 Dependencies

- **Express** - Web framework
- **Mongoose** - MongoDB ODM
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing
- **Passport** - Authentication middleware
- **Socket.io** - Real-time communication
- **Nodemailer** - Email sending
- **Multer** - File uploads
- **Cors** - Cross-origin requests
- **Helmet** - Security headers

## 🚀 Real-time Features

Socket.io events:
- `user-connected` - User comes online
- `whisper-alert` - Send alert to contacts
- `forum-message` - Send forum message
- `pulse-response` - Respond to pulse check
- `disconnect` - User goes offline

## 🐛 Troubleshooting

### Port 5000 already in use
```bash
# Find and kill process on port 5000
lsof -i:5000
kill -9 <PID>
```

### MongoDB connection error
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
Ensure MongoDB is running: `mongod`

### JWT token errors
Verify JWT_SECRET is set in .env file

### Google OAuth errors
Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are valid

## 📝 Development Notes

- Uses MongoDB for persistence
- Real-time updates via Socket.io
- JWT-based stateless authentication
- Middleware stack for security and logging
- Rate limiting to prevent abuse

## 🌍 Deployment

For production deployment:

1. Set `NODE_ENV=production`
2. Use a process manager (PM2)
3. Configure proper MongoDB instance
4. Set all required environment variables
5. Use HTTPS/TLS certificates
6. Configure CORS for production domain

```bash
npm install -g pm2
pm2 start server.js --name "safeherhub-api"
```

---

For more information about the full SafeHerHub project, see the main [README.md](../README.md)
