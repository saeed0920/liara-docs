# 🤖 How to Use the AI Assistant

## ✅ Current Status

**The AI Assistant is NOW LIVE and using REAL API (not mock data)**

- ✅ UI Component integrated globally
- ✅ Real transport enabled (connected to `/api/docs-query`)
- ✅ Mock data disabled (except for `/assistant-demo` preview)
- ✅ API endpoint working
- ✅ Database configured
- ✅ Engine running

## 🌐 How to Access

### Option 1: Direct Browser Access
1. Open your browser
2. Navigate to: **http://localhost:3001**
3. Look for the **floating button** in the bottom-right corner
4. Click it to open the assistant

### Option 2: Any Documentation Page
The assistant is available on ALL documentation pages:
- http://localhost:3001/paas/domains/add-domain/
- http://localhost:3001/paas/django/
- http://localhost:3001/dbaas/postgresql/
- Any other documentation page

## 🎯 Using the Assistant

### Step 1: Open the Assistant
- Click the **floating sparkle button** (✨) in the bottom-right corner
- Or press `Cmd+I` (Mac) / `Ctrl+I` (Windows/Linux)

### Step 2: Choose a Mode
Three modes available:
1. **معمولی (Normal)** - Quick answer with sources
2. **آموزش مرحله‌ای (Tutorial)** - Step-by-step guide
3. **فقط دستور (Command)** - Commands only, no explanation

### Step 3: Ask Your Question
Type your question in Persian, for example:
- "چطور دامنه را به برنامه متصل کنم؟" (How do I connect a domain?)
- "چطور برنامه را در لیارا مستقر کنم؟" (How do I deploy an app on Liara?)
- "چطور به دیتابیس وصل شوم؟" (How do I connect to database?)

### Step 4: Get Streaming Response
- See response stream in real-time
- Click citations `[S1]`, `[S2]`, etc. to jump to source documentation
- Use suggested follow-up questions

## 🎹 Keyboard Shortcuts

- `Cmd/Ctrl + I` - Open/Close assistant
- `Esc` - Close assistant
- `Enter` - Send message
- `Shift + Enter` - New line in message

## 🎨 UI Features

### Floating Button
- Always visible in bottom-right corner
- Sparkle icon (✨)
- Click to open/close

### Assistant Panel
- **Desktop**: Dock-right panel (slides from right)
- **Mobile**: Bottom sheet (slides from bottom)
- Shows conversation history
- Displays sources with citations
- Stop/Retry buttons during streaming

### Citations
- Format: `[S1]`, `[S2]`, `[S3]`, `[S4]`, `[S5]`
- Click to navigate to source
- Highlights relevant section on page

### Suggestions
- Auto-suggested follow-up questions
- Click to ask immediately

## 🔧 Configuration

### Current Settings (Database)
```
Assistant Enabled: ✅ YES
Rate Limit (per minute): 60 requests
Rate Limit (per day): 1,000 requests
Model: deepseek-v4-flash
```

### Admin Panel
Access at: **http://localhost:3001/admin**
- Username: `admin`
- Password: Check `.env` file

Can configure:
- Enable/Disable assistant
- Rate limits
- AvalAI API key
- Model selection

## ⚡ Performance Notes

### Current Response Times
- First token: ~10 seconds (optimizing)
- Complete response: 15-25 seconds
- Retrieval: ~7 seconds (needs optimization)

### Why Might It Be Slow?
The engine is currently affected by proxy settings which slows down embedding API calls. This is a known issue being optimized.

### What Works Right Now
✅ End-to-end flow works
✅ Real API responses (not mock)
✅ Citations link to actual docs
✅ Streaming works
✅ Sources are validated
✅ Rate limiting active

## 🐛 Troubleshooting

### "I don't see the floating button"
1. Hard refresh: `Cmd/Ctrl + Shift + R`
2. Clear browser cache
3. Check browser console for errors (F12)
4. Make sure JavaScript is enabled

### "Button is there but nothing happens when I click"
1. Check browser console (F12) for errors
2. Verify API is running: http://localhost:3001/api/docs-query/
3. Check database is accessible

### "I get an error when asking a question"
1. Check rate limits (60/min, 1000/day)
2. Make sure engine is running: http://localhost:3100/health
3. Check admin panel: http://localhost:3001/admin

### "Response is very slow"
This is expected currently due to:
- Proxy environment variables affecting engine
- Embedding API calls taking 5-7 seconds
- Being optimized for production

### "I see 'منبع کافی پیدا نشد' (No source found)"
This means the system couldn't find relevant documentation for your question. Try:
- Rephrasing your question
- Being more specific
- Using keywords from the documentation

## 📊 Monitoring

### View Metrics
Admin dashboard: http://localhost:3001/admin
- Request counts
- Success/error rates
- Response times (p50/p95)
- Token usage
- Cost estimates

### Check Logs
```bash
# Next.js logs
tail -f /tmp/nextjs-real-transport.log

# Engine logs
tail -f /tmp/engine-env.log
```

## 🔐 Security Features

- ✅ No conversation stored in database
- ✅ Rate limiting by IP and session
- ✅ Request validation
- ✅ XSS protection
- ✅ Citations validated
- ✅ Sources grounded in real docs

## 📱 Mobile Support

Works on mobile devices:
- Touch-friendly interface
- Bottom sheet layout
- Swipe to close
- Responsive design

## 🎓 Example Questions to Try

### Domain Management
```
چطور دامنه را به برنامه اضافه کنم؟
چطور SSL را فعال کنم؟
```

### Deployment
```
چطور برنامه Node.js را مستقر کنم؟
چطور با Docker در لیارا کار کنم؟
```

### Database
```
چطور به PostgreSQL وصل شوم؟
چطور MongoDB را راه‌اندازی کنم؟
```

### General
```
برای شروع راهنمایی‌ام کن.
پلتفرم‌های پشتیبانی شده کدامند؟
```

## 🚀 Next Steps

1. **Try it now**: http://localhost:3001
2. Test different question types
3. Try all three modes (Normal, Tutorial, Command)
4. Check citations and sources
5. Provide feedback for improvements

## 📞 Support

If you encounter issues:
1. Check this guide first
2. Review browser console errors
3. Check admin panel status
4. Verify all services are running
5. Review `/tmp/*.log` files

---

**The assistant is LIVE and ready to use! 🎉**

Open http://localhost:3001 in your browser and look for the floating button!
