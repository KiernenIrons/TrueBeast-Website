/**
 * TrueBeast Website — Site Configuration
 * =======================================
 * Edit this file to customize your website. Changes here automatically
 * update links, videos, and features across all pages.
 */

const SITE_CONFIG = {

    // -----------------------------------------------------------------------
    // SITE URL
    // Your live website URL. Used to build "View Ticket" links in emails.
    // For GitHub Pages it's usually: https://USERNAME.github.io/REPO-NAME
    // -----------------------------------------------------------------------
    siteUrl: 'https://truebeast.io',

    // -----------------------------------------------------------------------
    // DONATION LINK — shown on Connect section, ticket success screen, etc.
    // Set to null to hide all donation prompts.
    // -----------------------------------------------------------------------
    donationUrl: 'https://streamelements.com/realtruebeast-07c4f/tip',

    // -----------------------------------------------------------------------
    // SOCIAL MEDIA LINKS
    // Set a URL string to show the icon. Set to null to hide it entirely.
    // -----------------------------------------------------------------------
    social: {
        youtube:   'https://www.youtube.com/@RealTrueBeast',
        discord:   'https://discord.gg/Nk8vekY',
        twitter:   'https://x.com/TrueBeast_YT',
        instagram: 'https://www.instagram.com/kiernen_100/',
        tiktok:    'https://www.tiktok.com/@realtruebeast',
        twitch:    'https://www.twitch.tv/realtruebeast',
    },

    // -----------------------------------------------------------------------
    // YOUTUBE API — Auto-updating Content Section
    //
    // When configured, the homepage fetches your latest videos automatically.
    // Falls back to the static `videos` list below if not configured.
    //
    // HOW TO GET YOUR CHANNEL ID:
    //   → Go to https://www.youtube.com/@RealTrueBeast
    //   → Click your profile icon → YouTube Studio
    //   → Settings (left sidebar) → Channel → Basic info
    //   → Copy the "Channel ID" (starts with UC...)
    //
    // HOW TO CREATE A RESTRICTED API KEY (free, ~100 searches/day):
    //   1. Go to https://console.cloud.google.com/
    //   2. Create a project (or reuse an existing one)
    //   3. In the search bar type "YouTube Data API v3" → Enable it
    //   4. Sidebar: APIs & Services → Credentials → Create Credentials → API key
    //   5. Click "Edit API key" (pencil icon):
    //        - Name: "TrueBeast Site — YouTube"
    //        - Application restrictions: "Websites" → Add https://truebeast.io/*
    //        - API restrictions: Restrict key → select "YouTube Data API v3"
    //        - Save
    //   6. Copy the key and paste it below
    // -----------------------------------------------------------------------
    youtube: {
        channelId: 'UCPwd8BU-o5RvD0Osh6Z_4gQ',   // Your YouTube channel ID (UC...)
        apiKey:    'AIzaSyAYdxrqsX--VaejPEJIiXjg2bE4JoNoNgE',    // From Google Cloud Console (step 4 above)
        maxResults: 4,                               // How many video cards to show (2 or 4)
    },

    // -----------------------------------------------------------------------
    // YOUTUBE VIDEOS — Static Fallback
    // Shown when the YouTube API is not configured or unreachable.
    // These are also used as placeholders until the API loads.
    //
    // Find a video ID: go to the video on YouTube, copy the part after "?v="
    //   Example URL:  https://www.youtube.com/watch?v=dQw4w9WgXcQ
    //   Video ID:     dQw4w9WgXcQ
    // -----------------------------------------------------------------------
    videos: [
        {
            id:       've7X66ROqGs',
            title:    'Latest Upload',
            category: 'Gaming'
        },
        {
            id:       'uuyDxFe9-sY',
            title:    'Community Favorite',
            category: 'Group'
        },
        {
            id:       '6cSM0JOTAL4',
            title:    'Trending Now',
            category: 'Highlights'
        },
        {
            id:       'DEmAkXZBxX4',
            title:    'Deep Dive',
            category: 'Tech'
        },
    ],

    // -----------------------------------------------------------------------
    // TOOLS — My Toolkit page (truebeast.io/tools/)
    // Add an entry for each tool/software you want to recommend.
    // category options: 'Gaming' | 'Streaming' | 'PC & Hardware' | 'Utilities' | 'Creative'
    // -----------------------------------------------------------------------
    tools: [
        { name: 'OBS Studio', description: 'Free, open-source streaming and recording software. The go-to for any streamer.', url: 'https://obsproject.com', category: 'Streaming', emoji: '🎥' },
    ],

    // -----------------------------------------------------------------------
    // GIVEAWAYS — Giveaways page (truebeast.io/giveaways/)
    // Add an entry for each giveaway. Images go in assets/images/winners/.
    // status options: 'open' | 'upcoming' | 'ended'
    // Leave winner as '' if status is 'open' or 'upcoming' — shows "Winner TBD"
    // -----------------------------------------------------------------------
    giveaways: [
        { item: 'Microphone - Blue Yeti Satin Red', winner: 'SoundLogic', description: 'A brand new Multi-Pattern USB Microphone with Blue VO!CE', image: 'assets/images/winners/BlueYeti.jpg', date: '2024-12-26', status: 'ended' },
    ],

    // -----------------------------------------------------------------------
    // BREVO — Ticket Emails & Reply Notifications
    //
    // Brevo (formerly Sendinblue) — free tier: 300 emails/day, no template limits.
    // The API key is stored securely in Cloudflare — NOT in this file.
    //
    // ONE-TIME SETUP — see cloudflare-worker/email-proxy.js for full steps.
    // Short version:
    //   1. Sign up free at https://app.brevo.com → verify kiernenyt@gmail.com as sender
    //   2. Brevo → API Keys → Create key → copy it
    //   3. Deploy cloudflare-worker/email-proxy.js to Cloudflare Workers
    //   4. In the Worker settings add secret BREVO_API_KEY = (your key)
    //   5. Paste your Worker URL below
    //
    // Until workerUrl is set, all ticket emails are silently skipped.
    //
    // The Brevo API key is stored as a Cloudflare secret — never in this file.
    // See cloudflare-worker/email-proxy.js for setup instructions.
    // -----------------------------------------------------------------------
    brevo: {
        workerUrl:   'https://truebeast-email.kiernens-account.workers.dev/',   // e.g. https://truebeast-email.xyz.workers.dev
        senderName:  'TrueBeast Support',
        senderEmail: 'kiernenyt@gmail.com',
        adminEmail:  'kiernenyt@gmail.com',
    },

    // -----------------------------------------------------------------------
    // FIREBASE — Ticket Database & Admin Authentication
    //
    // HOW TO SET UP (takes about 10 minutes, completely free):
    //
    //  Step 1 — Create a Firebase project:
    //    → Go to https://console.firebase.google.com
    //    → Click "Create a project" → name it "TrueBeast-Support"
    //    → Disable Google Analytics → Create project
    //
    //  Step 2 — Set up Firestore (the database):
    //    → Sidebar: Build > Firestore Database → Create database
    //    → Choose "Start in production mode" → pick a region → Enable
    //    → Go to the "Rules" tab and paste:
    //
    //        rules_version = '2';
    //        service cloud.firestore {
    //          match /databases/{database}/documents {
    //            match /tickets/{ticketId} {
    //              allow create: if true;
    //              allow get:    if true;
    //              // Unauthenticated users can only add replies (responses + updatedAt).
    //              // Admins can update anything.
    //              allow update: if request.auth != null ||
    //                request.resource.data.diff(resource.data).affectedKeys()
    //                  .hasOnly(['responses', 'updatedAt']);
    //              allow list, delete: if request.auth != null;
    //            }
    //            match /reviews/{reviewId} {
    //              allow create:        if true;
    //              allow get, list:     if true;    // public — homepage reads approved reviews
    //              allow update, delete: if request.auth != null;
    //            }
    //            match /announcements/{docId} {
    //              allow read:          if true;    // public — homepage reads announcements
    //              allow write:         if request.auth != null;
    //            }
    //          }
    //        }
    //
    //    → Click "Publish"
    //
    //  Step 3 — Set up Authentication (for admin login):
    //    → Sidebar: Build > Authentication → Get started
    //    → Sign-in method tab → Enable "Email/Password"
    //    → Users tab → Add user → Enter YOUR email + a strong password
    //      (this is your admin login — never share it)
    //
    //  Step 4 — Get your config keys:
    //    → Sidebar: Project Settings (gear icon, top left)
    //    → Scroll to "Your apps" → click the Web icon (</>)
    //    → Register app (any name) → copy the firebaseConfig values below
    //
    //  Step 5 — Paste your values and push to GitHub. Done!
    // -----------------------------------------------------------------------
    firebase: {
        apiKey:            'AIzaSyClA0dmz4D3TDbhwvWmUeVinW6A18NQUUU',
        authDomain:        'truebeast-support.firebaseapp.com',
        projectId:         'truebeast-support',
        storageBucket:     'truebeast-support.firebasestorage.app',
        messagingSenderId: '726473476878',
        appId:             '1:726473476878:web:c4439471895d7edf9b255f',
    },

};
