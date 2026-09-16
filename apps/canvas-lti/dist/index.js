"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const ltijs_1 = require("ltijs");
const bedrock_1 = require("./bedrock");
const express_1 = __importDefault(require("express"));
// Setup provider
ltijs_1.Provider.setup(process.env.LTI_KEY || 'SECRET_LTI_KEY', {
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
ltijs_1.Provider.onConnect((token, req, res) => {
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
ltijs_1.Provider.app.post('/api/ask', express_1.default.json(), async (req, res) => {
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
        const request = {
            mode: mode,
            context: mockCanvasMaterial,
            query
        };
        const answer = await (0, bedrock_1.invokeBedrock)(request);
        return res.json({ text: answer });
    }
    catch (error) {
        console.error('Error invoking Bedrock:', error);
        return res.status(500).json({ error: error.message });
    }
});
async function start() {
    await ltijs_1.Provider.deploy({ port: 3000, serverless: false });
    console.log('Canvas LTI Provider running on port 3000');
}
start();
