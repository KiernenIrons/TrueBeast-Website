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
    siteUrl: 'https://kiernenIrons.github.io/TrueBeast-Website',

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
    // YOUTUBE VIDEOS — Content Section
    // Find a video ID: go to the video on YouTube, copy the part after "?v="
    //   Example URL:  https://www.youtube.com/watch?v=dQw4w9WgXcQ
    //   Video ID:     dQw4w9WgXcQ
    //
    // Each video needs:
    //   id       — YouTube video ID (REQUIRED)
    //   title    — Display title shown on the card
    //   category — Tag shown on the card (e.g. "Gaming", "IRL", "Highlights")
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
    // EMAILJS — Tech Support Ticket Emails
    //
    // Sign up free at https://emailjs.com, then:
    //   1. Create an Email Service (Gmail, Outlook, etc.)
    //      → In EmailJS dashboard: "Email Services" in the left sidebar
    //      → Click "Add New Service" → connect Gmail/Outlook
    //      → The service card will show an ID like "service_xxxxxxx" — paste it below
    //   2. Create Email Templates using the HTML files in email-templates/
    //   3. Copy your Public Key, Service ID, and Template IDs below
    //
    // Template files:
    //   email-templates/ticket-confirmation.html  → ticketTemplateId  (sent to user)
    //   email-templates/admin-notification.html   → adminTemplateId   (sent to you)
    //
    // Until serviceId is filled in, ticket emails are silently skipped.
    // -----------------------------------------------------------------------
    emailjs: {
        publicKey:        'ILZQ2BAHfBck_4yY-',
        serviceId:        'service_m74ipl2',
        ticketTemplateId: 'template_8jr2abr',
        adminTemplateId:  'template_9asbzsc',
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
    //              allow list, update, delete: if request.auth != null;
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
