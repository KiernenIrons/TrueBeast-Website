/**
 * TrueBeast — Google Apps Script: Gmail Email Sender
 * ====================================================
 * This script runs inside Google Apps Script (script.google.com)
 * and sends emails directly from your Gmail account.
 *
 * Free limits:
 *   @gmail.com accounts  → 100 emails/day
 *   Google Workspace     → 1,500 emails/day
 * That's more than enough for a tech support site.
 *
 * SETUP STEPS (one-time, ~5 minutes):
 *
 *  1. Go to https://script.google.com
 *  2. Click "New project"
 *  3. Name it "TrueBeast Email"
 *  4. Delete the default code and paste THIS file's contents
 *  5. Click the gear icon (Project Settings)
 *     → Under "Script Properties" click "Add script property"
 *     → Property name: SECRET
 *     → Value: (make up any long random string, e.g. "TrueBeast-secret-2026-xyz")
 *     → Click Save
 *  6. Click "Deploy" → "New deployment"
 *     → Type: Web app
 *     → Execute as: Me (kiernenyt@gmail.com)
 *     → Who has access: Anyone
 *     → Click "Deploy" → copy the Web app URL
 *  7. In your Cloudflare Worker settings → Environment Variables:
 *     Add a new secret:
 *       Name:  APPS_SCRIPT_URL
 *       Value: (paste the Web app URL from step 6)
 *     Add another secret:
 *       Name:  APPS_SCRIPT_SECRET
 *       Value: (the same random string you used in step 5)
 *  8. Update the Cloudflare Worker code (email-proxy.js) — already done!
 *  9. That's it. Emails now send from your Gmail, zero third-party services.
 */

function doPost(e) {
    try {
        const props  = PropertiesService.getScriptProperties();
        const secret = props.getProperty('SECRET');
        const data   = JSON.parse(e.postData.contents);

        // Simple secret check so random people can't spam via your script
        if (!secret || data.secret !== secret) {
            return ContentService
                .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        // Send the email from your Gmail account
        MailApp.sendEmail({
            to:       data.to,
            subject:  data.subject,
            htmlBody: data.html,
            name:     data.senderName || 'TrueBeast Support',
        });

        return ContentService
            .createTextOutput(JSON.stringify({ success: true }))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService
            .createTextOutput(JSON.stringify({ error: err.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// GET handler — useful for testing the script is deployed correctly
function doGet() {
    return ContentService
        .createTextOutput(JSON.stringify({ status: 'TrueBeast email script is running' }))
        .setMimeType(ContentService.MimeType.JSON);
}
