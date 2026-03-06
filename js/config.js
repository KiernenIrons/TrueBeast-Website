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
        { item: 'Wireless Gaming Keyboard - Dierya DK63', winner: 'nSamity', description: 'A White Mechanical Gaming Keyboard with RGB Lighting', image: 'assets/images/winners/Keyboard.jpg', date: '2025-04-14', status: 'ended' },
        { item: 'Microphone - Blue Yeti Satin Red', winner: 'SoundLogic', description: 'A brand new Multi-Pattern USB Microphone with Blue VO!CE', image: 'assets/images/winners/BlueYeti.jpg', date: '2024-12-26', status: 'ended' },
        { item: 'Ultimate Game Pass - 3 Months', winner: 'Mitsukunii', description: 'A 3 month Xbox Ultimate Game Pass', image: 'assets/images/winners/Xbox3month.jpg', date: '2023-12-24', status: 'ended' },
        { item: 'Ultimate Game Pass - 3 Months', winner: 'TinyKay', description: 'A 3 month Xbox Ultimate Game Pass', image: 'assets/images/winners/Xbox3month.jpg', date: '2023-12-24', status: 'ended' },
        { item: 'Ultimate Game Pass - 3 Months', winner: 'SoundLogic', description: 'A 3 month Xbox Ultimate Game Pass', image: 'assets/images/winners/Xbox3month.jpg', date: '2023-12-24', status: 'ended' },
        { item: 'Ultimate Game Pass - 3 Months', winner: 'The Technical difficulties', description: 'A 3 month Xbox Ultimate Game Pass', image: 'assets/images/winners/Xbox3month.jpg', date: '2021-11-07', status: 'ended' },
        { item: 'Steam Game - Battlefield 5', winner: 'Nerding Freak', description: 'A first person shooter game developed by DICE', image: 'assets/images/winners/BattleField5.jpg', date: '2021-08-20', status: 'ended' },
        { item: 'Ipad Mini - 6th Generation', winner: '', description: 'When we hit 100k subscribers, I will be giving away a brand new Ipad Mini 6th Generation', image: 'assets/images/winners/IpadMini.jpg', date: '', status: 'upcoming' },
    ],

    // -----------------------------------------------------------------------
    // EMAIL — Ticket Emails & Reply Notifications
    //
    // Emails are sent directly from your Gmail via Google Apps Script.
    // No third-party email service. No limits beyond Gmail's own (100/day free).
    //
    // ONE-TIME SETUP — see cloudflare-worker/gmail-apps-script.js for full steps.
    // Short version:
    //   1. Go to https://script.google.com → New project → paste gmail-apps-script.js
    //   2. Set a script property: SECRET = (any long random string)
    //   3. Deploy as a Web app (Execute as: Me, Access: Anyone) → copy URL
    //   4. In your Cloudflare Worker settings add two secrets:
    //        APPS_SCRIPT_URL    = (the Web app URL from step 3)
    //        APPS_SCRIPT_SECRET = (the same random string from step 2)
    //   5. Paste your Worker URL below (same Worker, already deployed)
    //
    // The workerUrl here is safe to commit — secrets live in Cloudflare only.
    // -----------------------------------------------------------------------
    email: {
        workerUrl:   'https://truebeast-email.kiernens-account.workers.dev/',
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
