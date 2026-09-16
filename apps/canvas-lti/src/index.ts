// @ts-nocheck
import * as dotenv from 'dotenv';
dotenv.config();

import { Provider } from 'ltijs';
import { invokeBedrock, ExplanationRequest } from './bedrock';
import express from 'express';

// Setup provider
Provider.setup(process.env.LTI_KEY || 'SECRET_LTI_KEY', {
  appRoute: '/', loginRoute: '/login', keysetRoute: '/keys'
}, {
  staticPath: 'public', // serve static files from public
  cookies: {
    secure: false, // Set to true in production
    sameSite: ''
  },
  devMode: true // Set to false in production
});

// When an LTI launch occurs, this route gets hit
Provider.onConnect((token, req, res) => {
  console.log('Successful LTI launch from Canvas!');
  
  // Custom context data passed from canvas
  const context = res.locals.context;
  
  // Render a simple embedded UI for the student
  // In a real app, you would serve a React/Vue SPA and pass the token
  return res.send(`
    <html>
      <head>
        <title>Bedrock AI Canvas Tool</title>
        <style>
          body { font-family: sans-serif; padding: 2rem; background: #f4f6f8; }
          .container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          button { padding: 10px 15px; margin-right: 10px; border: none; background: #0056b3; color: white; border-radius: 4px; cursor: pointer; }
          button:hover { background: #004494; }
          #response { margin-top: 20px; white-space: pre-wrap; background: #eee; padding: 15px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>AccessLens: Canvas AI Assistant</h2>
          <p>This tool uses AWS Bedrock to provide accessible explanations of your course content.</p>
          <div style="margin-bottom: 20px;">
            <button onclick="ask('explain')">Explain Content</button>
            <button onclick="ask('simplify')">Simplify Content</button>
            <button onclick="ask('diagram')">Generate Diagram</button>
          </div>
          <div id="response"></div>
        </div>
        <script>
          async function ask(mode) {
            document.getElementById('response').innerText = 'Thinking...';
            try {
              const res = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ${res.locals.token}' },
                body: JSON.stringify({ mode })
              });
              const data = await res.json();
              document.getElementById('response').innerText = data.text;
            } catch (err) {
              document.getElementById('response').innerText = 'Error: ' + err.message;
            }
          }
        </script>
      </body>
    </html>
  `);
});

// API endpoint for the embedded UI to call Bedrock
Provider.app.post('/api/ask', express.json(), async (req, res) => {
  try {
    const { mode, query } = req.body;
    
    // Grab the LTI context safely extracted by ltijs during the session
    const ltiContext = res.locals.context;
    // Extract meaningful text from context. In a real LTI 1.3 Advantage setup, 
    // we would call the Canvas API (using Names and Roles Provisioning Services, or Deep Linking) 
    // to get the actual assignment text. For now, we mock the Canvas assignment data.
    
    const mockCanvasMaterial = `
      Course: ${ltiContext?.context?.title || 'Unknown Course'}
      Description: This module covers the structure and function of the eukaryotic cell.
    `;

    const request: ExplanationRequest = {
      mode: mode as 'explain' | 'simplify' | 'diagram',
      context: mockCanvasMaterial,
      query
    };

    const answer = await invokeBedrock(request);
    return res.json({ text: answer });
  } catch (error: any) {
    console.error('Error invoking Bedrock:', error);
    return res.status(500).json({ error: error.message });
  }
});

async function start() {
  await Provider.deploy({ port: 3000, serverless: false });
  console.log('Canvas LTI Provider running on port 3000');
}

start();
