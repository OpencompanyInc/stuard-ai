/**
 * Marketplace Security Analyzer
 * 
 * AI-powered analysis system to check workflow JSON for:
 * - Security vulnerabilities
 * - Malicious patterns
 * - Information theft attempts
 * - Guideline compliance
 * - Best practices
 */

import { generateText } from 'ai';
import { google } from '../utils/models';

export interface SecurityAnalysisResult {
  passed: boolean;
  overallScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  issues: SecurityIssue[];
  warnings: SecurityWarning[];
  recommendations: string[];
  summary: string;
}

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  description: string;
  location?: string; // Node ID or path in JSON
  remediation?: string;
}

export interface SecurityWarning {
  category: string;
  message: string;
  suggestion?: string;
}

// Dangerous patterns to check for
const DANGEROUS_PATTERNS = {
  // File system attacks
  pathTraversal: /\.\.[\/\\]/g,
  sensitiveFiles: /\/(etc\/passwd|\.ssh|\.env|\.git|credentials|secrets|tokens|api_?keys?)/gi,
  systemDirs: /^(C:\\Windows|\/etc|\/root|\/var\/log|%APPDATA%|%USERPROFILE%)/gi,
  
  // Code injection
  evalPatterns: /\b(eval|exec|compile|__import__|subprocess\.call|os\.system)\s*\(/gi,
  shellInjection: /[;&|`$(){}[\]]/g,
  
  // Network exfiltration
  suspiciousUrls: /(pastebin|hastebin|transfer\.sh|file\.io|0x0\.st|webhook\.site|requestbin|ngrok\.io|serveo\.net|localtunnel|cloudflared)/gi,
  ipAddressHardcoded: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  
  // Credential harvesting
  credentialKeywords: /\b(password|passwd|secret|api_?key|token|auth|bearer|credential|private_?key)\b/gi,
  
  // Crypto/ransomware patterns
  encryptionPatterns: /\b(encrypt|decrypt|cipher|AES|RSA|base64|encode)\b/gi,
  
  // Keylogging patterns
  keylogPatterns: /\b(keylog|keystroke|key_?press|keyboard_?hook|input_?capture)\b/gi,
  
  // Data exfiltration patterns in code
  httpClientPatterns: /\b(requests\.(post|put|patch|send)|axios\.(post|put|patch)|fetch\s*\(|http\.request|curl|wget|urllib\.request)\b/gi,
  socketPatterns: /\b(socket\.(connect|sendall|send)|Socket|net\.Socket|dgram)\b/gi,
  smtpPatterns: /\b(smtplib|sendmail|email\.mime|nodemailer)\b/gi,
  ftpPatterns: /\b(ftplib|ftp\.|sftp|ssh\.SFTP)\b/gi,
  databasePatterns: /\b(mongodb:\/\/|mongoose\.connect|postgres:|mysql\.connect|sqlite3|redis\.connect|firebase|supabase)\b/gi,
  cloudStoragePatterns: /\b(s3\.|boto3|azure\.storage|google\.cloud\.storage|dropbox|box\.com|onedrive)\b/gi,
  externalApiPatterns: /\b(api\.openai\.com|api\.anthropic|api\.google|api\.stripe|api\.twilio|slack\.com|discord\.com\/api)\b/gi,
  
  // Data serialization for transmission
  dataPackingPatterns: /\b(json\.dumps|pickle\.dumps|base64\.b64encode|marshal\.dumps|struct\.pack)\b/gi,
  compressionPatterns: /\b(gzip\.compress|zlib\.compress|zipfile|tarfile|shutil\.make_archive)\b/gi,
  
  // File reading for exfiltration
  fileReadingPatterns: /\b(open\s*\(|fs\.readFile|readFileSync|readlines|csv\.reader|pandas\.read_)\b/gi,
  
  // Clipboard/sensitive data access
  clipboardPatterns: /\b(pyperclip|clipboard|GetClipboardData|pasteboard|clipboardy)\b/gi,
  browserDataPatterns: /\b(chrome.*password|firefox.*cookie|browser.*history|cookies\.sqlite|login data)\b/gi,
};

// Tools that require extra scrutiny
const HIGH_RISK_TOOLS = [
  'run_command',
  'run_python_script',
  'run_node_script',
  'write_file',
  'move_file',
  'launch_application_or_uri',
  'send_hotkey',
  'type_text',
  'click_at_coordinates',
];

// Tools that can exfiltrate data
const EXFILTRATION_TOOLS = [
  'gmail_send_message',
  'outlook_send_mail',
  'outlook_reply_message',
  'outlook_forward_message',
  'scrape_url',
  'web_search',
  'http_request',
  'api_call',
];

// Tools that are local-only and safe
const LOCAL_ONLY_TOOLS = [
  'click_at_coordinates',
  'double_click_at_coordinates',
  'scroll',
  'drag_and_drop',
  'get_mouse_position',
  'type_text',
  'send_hotkey',
  'wait',
  'log',
  'send_notification',
  'take_screenshot', // local capture only
  'capture_media',   // local capture only
  'set_clipboard_content',
  'get_clipboard_content',
];

// Network-related packages in Python/Node
const NETWORK_PACKAGES = [
  'requests', 'urllib3', 'httpx', 'aiohttp', 'socket', 'ssl',
  'axios', 'node-fetch', 'undici', 'got', 'superagent',
  'smtplib', 'email', 'nodemailer', 'mailgun-js',
  'ftplib', 'paramiko', 'pysftp', 'ssh2-sftp-client',
  'pymongo', 'psycopg2', 'mysql-connector', 'sqlite3', 'redis', 'firebase-admin',
  'boto3', 'azure-storage', 'google-cloud-storage', 'dropbox', '@supabase/supabase-js',
  'openai', '@anthropic-ai/sdk', '@google/generative-ai', 'stripe', 'twilio',
  'discord.js', '@slack/web-api', 'telegraf', 'pyrogram',
  'pyperclip', 'clipboardy', 'clipboard',
  'pynput', 'keyboard', 'mouse',
  'psutil', 'os', 'subprocess', 'ctypes', 'win32api', 'win32clipboard',
  'cryptography', 'pycryptodome', 'crypto', 'bcrypt', 'argon2',
];

// Suspicious data collection patterns
const DATA_COLLECTION_PATTERNS = [
  /os\.environ/gi,                          // Environment variables
  /process\.env/gi,                         // Node environment
  /platform\./gi,                           // System info
  /uname|sysinfo|systeminfo/gi,            // System information
  /whoami|getpass\.getuser|os\.getlogin/gi, // User identity
  /uuid|machineid|hwid|unique.*id/gi,      // Hardware ID
  /hostname|computername/gi,               // Machine name
  /getmac|mac_address|hwaddr/gi,           // MAC address
  /ipconfig|ifconfig|netstat|ip\s+addr/gi, // Network info
  /wmic|systeminfo|tasklist/gi,            // Windows system info
  /net\s+user|net\s+localgroup/gi,         // User enumeration
  /BrowserCookie|document\.cookie/gi,     // Cookie access
  /localStorage|sessionStorage/gi,         // Storage access
];

/**
 * Functions are published as flat workflow specs marked with `kind: 'function'`
 * and a `functionNode` field, but legacy publishes wrapped them as
 * `{ type: 'function', workflow, node }`. Normalize both into a flat workflow
 * spec the rest of the analyzer understands, while preserving whether the
 * artifact is a function (so the AI prompt can frame the review correctly).
 */
function unwrapSpec(spec: any): { workflow: any; isFunction: boolean } {
  if (spec && typeof spec === 'object') {
    if (spec.type === 'function' && spec.workflow) {
      return { workflow: spec.workflow, isFunction: true };
    }
    if (spec.kind === 'function') {
      return { workflow: spec, isFunction: true };
    }
  }
  return { workflow: spec, isFunction: false };
}

/**
 * Static analysis of workflow spec for known dangerous patterns
 */
function staticAnalysis(spec: any): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const specStr = JSON.stringify(spec);

  // Check for path traversal
  if (DANGEROUS_PATTERNS.pathTraversal.test(specStr)) {
    issues.push({
      severity: 'high',
      category: 'Path Traversal',
      title: 'Potential path traversal detected',
      description: 'The workflow contains "../" patterns that could be used to access files outside intended directories.',
      remediation: 'Use absolute paths or validate path inputs to prevent directory traversal attacks.',
    });
  }

  // Check for sensitive file access
  const sensitiveMatches = specStr.match(DANGEROUS_PATTERNS.sensitiveFiles);
  if (sensitiveMatches) {
    issues.push({
      severity: 'critical',
      category: 'Sensitive Data Access',
      title: 'Access to sensitive files/directories',
      description: `The workflow attempts to access potentially sensitive locations: ${[...new Set(sensitiveMatches)].join(', ')}`,
      remediation: 'Remove references to sensitive system files and directories.',
    });
  }

  // Check for suspicious URLs
  const urlMatches = specStr.match(DANGEROUS_PATTERNS.suspiciousUrls);
  if (urlMatches) {
    issues.push({
      severity: 'high',
      category: 'Data Exfiltration',
      title: 'Suspicious external services detected',
      description: `The workflow references services commonly used for data exfiltration: ${[...new Set(urlMatches)].join(', ')}`,
      remediation: 'Use trusted services and explain why these URLs are necessary.',
    });
  }

  // Check for eval/exec patterns in code
  if (DANGEROUS_PATTERNS.evalPatterns.test(specStr)) {
    issues.push({
      severity: 'high',
      category: 'Code Injection',
      title: 'Dynamic code execution detected',
      description: 'The workflow contains eval(), exec(), or similar dynamic code execution patterns.',
      remediation: 'Avoid dynamic code execution. Use safe alternatives.',
    });
  }

  // Check for hardcoded IPs
  const ipMatches = specStr.match(DANGEROUS_PATTERNS.ipAddressHardcoded);
  if (ipMatches && ipMatches.length > 0) {
    // Filter out common safe IPs
    const suspiciousIps = ipMatches.filter(ip => 
      !ip.startsWith('127.') && 
      !ip.startsWith('192.168.') && 
      !ip.startsWith('10.') &&
      ip !== '0.0.0.0'
    );
    if (suspiciousIps.length > 0) {
      issues.push({
        severity: 'medium',
        category: 'Network Security',
        title: 'Hardcoded IP addresses detected',
        description: `Found hardcoded IP addresses: ${[...new Set(suspiciousIps)].join(', ')}`,
        remediation: 'Use domain names or configurable parameters instead of hardcoded IPs.',
      });
    }
  }

  // Check for credential keywords in exposed locations
  const credMatches = specStr.match(DANGEROUS_PATTERNS.credentialKeywords);
  if (credMatches && credMatches.length > 3) {
    issues.push({
      severity: 'medium',
      category: 'Credential Exposure',
      title: 'Multiple credential-related keywords detected',
      description: 'The workflow contains multiple references to credentials, passwords, or API keys.',
      remediation: 'Ensure no actual credentials are hardcoded. Use secure variable references.',
    });
  }

  return issues;
}

/**
 * Analyze node-level risks with enhanced script analysis
 */
function analyzeNodes(spec: any): { 
  issues: SecurityIssue[]; 
  warnings: SecurityWarning[];
  dataFlow: {
    capturesData: boolean;
    sendsExternally: boolean;
    usesScripts: boolean;
    scriptNetworkActivity: boolean;
  };
} {
  const issues: SecurityIssue[] = [];
  const warnings: SecurityWarning[] = [];
  
  const nodes = spec.nodes || [];
  
  // Data flow tracking
  let capturesData = false;
  let sendsExternally = false;
  let usesScripts = false;
  let scriptNetworkActivity = false;
  
  // Count high-risk tools
  let highRiskCount = 0;
  let exfiltrationCount = 0;
  let localOnlyCount = 0;
  
  for (const node of nodes) {
    const tool = node.tool || node.uses;
    if (!tool) continue;

    const toolName = tool.replace('local.', '').replace('cloud.', '');
    
    // Track local vs external tools
    if (LOCAL_ONLY_TOOLS.includes(toolName)) {
      localOnlyCount++;
    }
    
    // Check for data capture
    if (['take_screenshot', 'capture_media', 'get_clipboard_content', 'read_file', 'get_mouse_position'].includes(toolName)) {
      capturesData = true;
    }
    
    if (HIGH_RISK_TOOLS.includes(toolName)) {
      highRiskCount++;
      
      // Check specific tool risks
      if (toolName === 'run_command') {
        const cmd = node.args?.command || node.with?.command || '';
        if (DANGEROUS_PATTERNS.shellInjection.test(cmd)) {
          issues.push({
            severity: 'high',
            category: 'Command Injection',
            title: 'Potential shell injection in command',
            description: `Node "${node.id}" contains shell metacharacters that could enable command injection.`,
            location: node.id,
            remediation: 'Sanitize command inputs and avoid shell metacharacters.',
          });
        }
        
        // Check for network commands in shell
        if (/\b(curl|wget|nc\s|netcat|scp|sftp|ftp|telnet|ssh)\b/i.test(cmd)) {
          warnings.push({
            category: 'Network Command',
            message: `Node "${node.id}" uses network commands in shell.`,
            suggestion: 'Verify this is the intended behavior and document data transmission.',
          });
          sendsExternally = true;
        }
      }
      
      if (toolName === 'run_python_script' || toolName === 'run_node_script') {
        usesScripts = true;
        const code = node.args?.code || node.with?.code || '';
        const packages = node.args?.packages || node.with?.packages || [];
        
        if (code.length > 5000) {
          warnings.push({
            category: 'Code Complexity',
            message: `Node "${node.id}" contains a very long script (${code.length} chars).`,
            suggestion: 'Consider breaking into smaller, reviewable pieces.',
          });
        }
        
        // Check for data collection patterns
        let hasDataCollection = false;
        for (const pattern of DATA_COLLECTION_PATTERNS) {
          if (pattern.test(code)) {
            hasDataCollection = true;
            break;
          }
        }
        
        // Check for file reading
        const hasFileReading = DANGEROUS_PATTERNS.fileReadingPatterns.test(code);
        
        // Check for network activity in scripts
        const hasNetworkActivity = 
          DANGEROUS_PATTERNS.httpClientPatterns.test(code) ||
          DANGEROUS_PATTERNS.socketPatterns.test(code) ||
          DANGEROUS_PATTERNS.smtpPatterns.test(code) ||
          DANGEROUS_PATTERNS.externalApiPatterns.test(code);
        
        // Check for database connections
        const hasDatabaseConnection = DANGEROUS_PATTERNS.databasePatterns.test(code);
        
        // Check for cloud storage
        const hasCloudStorage = DANGEROUS_PATTERNS.cloudStoragePatterns.test(code);
        
        // Check for data packing (serialization for transmission)
        const hasDataPacking = DANGEROUS_PATTERNS.dataPackingPatterns.test(code);
        
        // Check for suspicious packages
        const suspiciousPackages = packages.filter((p: string) => 
          NETWORK_PACKAGES.some(np => p.toLowerCase().includes(np.toLowerCase()))
        );
        
        if (hasNetworkActivity) {
          scriptNetworkActivity = true;
          sendsExternally = true;
          
          // High severity if combined with data collection or file reading
          if ((hasDataCollection || hasFileReading) && hasDataPacking) {
            issues.push({
              severity: 'high',
              category: 'Data Exfiltration Risk',
              title: `Script appears to collect and transmit data`,
              description: `Node "${node.id}" reads data (files, env vars, system info) and sends it over the network. This is a potential data exfiltration pattern.`,
              location: node.id,
              remediation: 'If this is intentional, document the data flow clearly. Otherwise, remove network transmission code.',
            });
          } else if (hasFileReading || hasDataCollection) {
            warnings.push({
              category: 'Data Transmission',
              message: `Node "${node.id}" script reads data and makes network requests.`,
              suggestion: 'Verify what data is being sent and ensure it is necessary.',
            });
          } else {
            warnings.push({
              category: 'Network Access',
              message: `Node "${node.id}" script makes network requests.`,
              suggestion: 'Ensure network access is documented and necessary.',
            });
          }
        }
        
        // Check for database/cloud storage without clear purpose
        if (hasDatabaseConnection || hasCloudStorage) {
          sendsExternally = true;
          warnings.push({
            category: 'External Storage',
            message: `Node "${node.id}" connects to external database or cloud storage.`,
            suggestion: 'Document what data is being stored externally and why.',
          });
        }
        
        // Warn about suspicious packages
        if (suspiciousPackages.length > 0) {
          warnings.push({
            category: 'Dependencies',
            message: `Node "${node.id}" uses packages that may access network/sensitive data: ${suspiciousPackages.join(', ')}`,
            suggestion: 'Review these dependencies and ensure they are necessary.',
          });
        }
        
        // Check for clipboard access (potential credential theft)
        if (DANGEROUS_PATTERNS.clipboardPatterns.test(code)) {
          warnings.push({
            category: 'Clipboard Access',
            message: `Node "${node.id}" accesses the clipboard.`,
            suggestion: 'Ensure clipboard access is for legitimate purposes only.',
          });
          capturesData = true;
        }
        
        // Check for browser data access
        if (DANGEROUS_PATTERNS.browserDataPatterns.test(code)) {
          issues.push({
            severity: 'high',
            category: 'Browser Data Access',
            title: 'Script attempts to access browser data',
            description: `Node "${node.id}" contains patterns that may access browser cookies, passwords, or history.`,
            location: node.id,
            remediation: 'Remove browser data access code. This is not appropriate for marketplace workflows.',
          });
        }
      }
    }
    
    if (EXFILTRATION_TOOLS.includes(toolName)) {
      exfiltrationCount++;
      sendsExternally = true;
    }
  }
  
  // Warn about excessive high-risk tools
  if (highRiskCount > 5) {
    warnings.push({
      category: 'Risk Assessment',
      message: `Workflow uses ${highRiskCount} high-risk tools (commands, scripts, file writes).`,
      suggestion: 'Consider if all these operations are necessary.',
    });
  }
  
  // Detect data exfiltration pattern: capture + send
  if (capturesData && sendsExternally) {
    if (scriptNetworkActivity) {
      issues.push({
        severity: 'high',
        category: 'Data Exfiltration',
        title: 'Workflow captures data and sends via script',
        description: 'This workflow reads sensitive data (screenshots, clipboard, files) and transmits it through script-based network calls. This is a high-risk pattern commonly used for data theft.',
        remediation: 'If legitimate, clearly document all data captured and where it is sent. Consider using built-in tools instead of custom scripts for data transmission.',
      });
    } else {
      warnings.push({
        category: 'Data Flow',
        message: 'Workflow captures data and sends to external services.',
        suggestion: 'Verify this is the intended behavior and document the data flow clearly.',
      });
    }
  }
  
  // Detect script-only workflows that might hide behavior
  if (usesScripts && localOnlyCount === 0 && exfiltrationCount === 0) {
    warnings.push({
      category: 'Script-Only Workflow',
      message: 'Workflow contains only scripts with no built-in tools.',
      suggestion: 'Scripts can hide behavior. Ensure all script functionality is clearly documented.',
    });
  }

  return { 
    issues, 
    warnings,
    dataFlow: {
      capturesData,
      sendsExternally,
      usesScripts,
      scriptNetworkActivity,
    }
  };
}

/**
 * AI-powered deep analysis for complex patterns
 */
async function aiAnalysis(spec: any, name: string, description: string, isFunction: boolean): Promise<{
  issues: SecurityIssue[];
  warnings: SecurityWarning[];
  recommendations: string[];
  summary: string;
}> {
  const artifactLabel = isFunction ? 'function' : 'workflow';

  const functionPrompt = `You are a security analyst reviewing a reusable FUNCTION for a marketplace.

WHAT A FUNCTION IS — READ THIS BEFORE ANALYZING:
- A function is a small, callable building block (like a library function). It is NOT a standalone end-to-end workflow.
- It declares typed inputs and outputs. A separate workflow — built and run by the installing user on their own machine — supplies those inputs and consumes the outputs.
- The installing user always sees the full source of the function before they install or call it. There is no opaque server-side execution.
- All node tools (e.g. ai_inference, http_request, run_python_script) are platform-provided primitives. The function spec only configures them; it does not implement them.

WHAT TO FLAG (function-specific):
- Hidden/obfuscated behavior the description doesn't disclose (e.g. a "format text" function that secretly POSTs data to a third-party server).
- Hardcoded credentials, secrets, or tokens baked into args.
- Calls to attacker-controlled or known-exfil services (pastebin, webhook.site, ngrok, etc.) that aren't justified by the function's purpose.
- Embedded scripts (run_python_script / run_node_script / run_command) whose code is malicious, dynamically eval's untrusted strings, reads sensitive files (browser cookies, ~/.ssh, .env), or exfiltrates data the function isn't supposed to touch.
- Material mismatch between the description and what the spec actually does (deceptive listing).

WHAT NOT TO FLAG (these are CALLER concerns, not function concerns):
- "Prompt injection via the {{trigger.data.X}} input." The caller chooses what to pass; sanitizing untrusted input is the caller's job. Only flag if the function itself injects something malicious into the prompt.
- "Path traversal via a path input." If the function takes a path and reads/passes it, that is its documented contract. Only flag if the function silently rewrites paths to access something the caller didn't ask for.
- "Sends data to a third-party AI provider." All ai_inference / cloud_tool calls go through Stuard's vetted providers (e.g. OpenRouter). This is the platform's documented behavior, not a privacy violation, unless the function additionally ships data somewhere undisclosed.
- "No input validation / no error handling / no rate limiting." These are code-quality concerns for an end-user app, not security issues for a function building block. Use a low-severity warning at most.
- "Lack of authentication." A function is invoked by another workflow on the same user's machine; there is no auth boundary to enforce.

SEVERITY RUBRIC:
- critical = clear malicious intent (credential theft, ransomware, covert exfiltration, browser-data harvesting).
- high = hidden behavior that doesn't match the description, or a strong exfiltration pattern.
- medium = a real concern a careful reviewer should raise (e.g. unexplained network call to an unusual host).
- low = nit / code-quality.
- Do NOT use critical or high for theoretical caller-controlled risks. If the only "issue" is "a hostile caller could pass a bad input," do not raise an issue at all.

FUNCTION NAME: ${name}
DESCRIPTION: ${description}

FUNCTION SPEC:
${JSON.stringify(spec, null, 2)}

RESPOND WITH VALID JSON ONLY (no markdown, no explanation):
{
  "issues": [{"severity": "low|medium|high|critical", "category": "string", "title": "string", "description": "string", "location": "nodeId or null", "remediation": "string"}],
  "warnings": [{"category": "string", "message": "string", "suggestion": "string"}],
  "recommendations": ["string"],
  "summary": "One paragraph summary of the security assessment, framed as a function review",
  "descriptionMatchesFunction": true/false,
  "suspiciousPatterns": ["pattern1", "pattern2"]
}`;

  const workflowPrompt = `You are a security analyst reviewing a workflow automation for a marketplace.
Analyze this workflow for security issues, malicious patterns, and guideline violations.

This is an event-driven workflow that runs end-to-end on a user's machine.

WORKFLOW NAME: ${name}
DESCRIPTION: ${description}

WORKFLOW SPEC:
${JSON.stringify(spec, null, 2)}

ANALYZE FOR:
1. **Malicious Intent**: Could this be used for malware, ransomware, keylogging, or data theft?
2. **Privacy Violations**: Does it access sensitive user data without clear purpose?
3. **Deceptive Behavior**: Does the workflow do something different than described?
4. **Resource Abuse**: Could it cause system instability or excessive resource usage?
5. **Compliance**: Does it follow best practices for automation workflows?

RESPOND WITH VALID JSON ONLY (no markdown, no explanation):
{
  "issues": [{"severity": "low|medium|high|critical", "category": "string", "title": "string", "description": "string", "location": "nodeId or null", "remediation": "string"}],
  "warnings": [{"category": "string", "message": "string", "suggestion": "string"}],
  "recommendations": ["string"],
  "summary": "One paragraph summary of the security assessment",
  "descriptionMatchesFunction": true/false,
  "suspiciousPatterns": ["pattern1", "pattern2"]
}`;

  const prompt = isFunction ? functionPrompt : workflowPrompt;

  try {
    const result = await generateText({
      model: google('gemini-2.5-pro') as any,
      prompt,
      maxOutputTokens: 4000,
    });

    const text = result.text.trim();
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        issues: [],
        warnings: [{ category: 'Analysis', message: 'AI analysis completed but returned unexpected format.' }],
        recommendations: [],
        summary: 'Automated analysis completed. Manual review recommended.',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // If description doesn't match the actual behavior, that's a red flag
    if (parsed.descriptionMatchesFunction === false) {
      parsed.issues = parsed.issues || [];
      parsed.issues.push({
        severity: 'high',
        category: 'Deceptive Description',
        title: `${isFunction ? 'Function' : 'Workflow'} behavior may not match description`,
        description: `The AI detected that the ${artifactLabel}'s actual behavior may differ from what is described.`,
        remediation: `Update the description to accurately reflect what the ${artifactLabel} does.`,
      });
    }

    return {
      issues: parsed.issues || [],
      warnings: parsed.warnings || [],
      recommendations: parsed.recommendations || [],
      summary: parsed.summary || 'Analysis completed.',
    };
  } catch (error) {
    console.error('[security-analyzer] AI analysis failed:', error);
    return {
      issues: [],
      warnings: [{ category: 'Analysis', message: 'AI analysis unavailable. Static checks only.' }],
      recommendations: ['Manual security review recommended.'],
      summary: 'Automated AI analysis could not be completed. Basic static checks passed.',
    };
  }
}

/**
 * Calculate overall security score
 */
function calculateScore(issues: SecurityIssue[]): { score: number; riskLevel: 'low' | 'medium' | 'high' | 'critical' } {
  let score = 100;
  
  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical': score -= 40; break;
      case 'high': score -= 25; break;
      case 'medium': score -= 10; break;
      case 'low': score -= 5; break;
    }
  }
  
  score = Math.max(0, score);
  
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (issues.some(i => i.severity === 'critical') || score < 30) {
    riskLevel = 'critical';
  } else if (issues.some(i => i.severity === 'high') || score < 50) {
    riskLevel = 'high';
  } else if (score < 70) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }
  
  return { score, riskLevel };
}

/**
 * Main security analysis function
 */
export async function analyzeWorkflowSecurity(
  spec: any,
  name: string,
  description: string
): Promise<SecurityAnalysisResult> {
  const { workflow, isFunction } = unwrapSpec(spec);

  // 1. Static analysis
  const staticIssues = staticAnalysis(workflow);

  // 2. Node-level analysis
  const { issues: nodeIssues, warnings: nodeWarnings } = analyzeNodes(workflow);

  // 3. AI-powered deep analysis
  const aiResult = await aiAnalysis(workflow, name, description, isFunction);
  
  // Combine all results
  const allIssues = [...staticIssues, ...nodeIssues, ...aiResult.issues];
  const allWarnings = [...nodeWarnings, ...aiResult.warnings];
  
  // Calculate score
  const { score, riskLevel } = calculateScore(allIssues);
  
  // Determine if it passes
  const passed = !allIssues.some(i => i.severity === 'critical') && score >= 40;
  
  return {
    passed,
    overallScore: score,
    riskLevel,
    issues: allIssues,
    warnings: allWarnings,
    recommendations: aiResult.recommendations,
    summary: aiResult.summary,
  };
}

/**
 * Quick check for obvious blockers (fast, no AI)
 */
export function quickSecurityCheck(spec: any): { blocked: boolean; reason?: string; dataFlow?: 'local' | 'external' | 'mixed' } {
  const { workflow } = unwrapSpec(spec);
  const specStr = JSON.stringify(workflow);
  
  // Immediate blockers - destructive actions
  if (DANGEROUS_PATTERNS.sensitiveFiles.test(specStr)) {
    return { blocked: true, reason: 'Workflow accesses sensitive system files.', dataFlow: 'local' };
  }
  
  if (/rm\s+-rf|format\s+c:|del\s+\/f\s+\/s/i.test(specStr)) {
    return { blocked: true, reason: 'Workflow contains destructive system commands.', dataFlow: 'local' };
  }
  
  if (/keylog|screen_?grab.*loop|infinite.*screenshot/i.test(specStr)) {
    return { blocked: true, reason: 'Workflow contains patterns associated with spyware.', dataFlow: 'external' };
  }
  
  // Data exfiltration blockers
  if (DANGEROUS_PATTERNS.browserDataPatterns.test(specStr)) {
    return { blocked: true, reason: 'Workflow attempts to access browser passwords or cookies.', dataFlow: 'external' };
  }
  
  // Check for scripts that send data + capture data
  const hasCaptureTools = /"(take_screenshot|capture_media|get_clipboard_content|read_file)"/.test(specStr);
  const hasScriptNetwork = DANGEROUS_PATTERNS.httpClientPatterns.test(specStr) || 
                           DANGEROUS_PATTERNS.socketPatterns.test(specStr);
  
  if (hasCaptureTools && hasScriptNetwork) {
    return { 
      blocked: true, 
      reason: 'Workflow captures sensitive data and sends it over the network via scripts. This pattern is commonly used for unauthorized data exfiltration.',
      dataFlow: 'external'
    };
  }
  
  // Check for suspicious exfiltration services with data packing
  if (DANGEROUS_PATTERNS.suspiciousUrls.test(specStr) && 
      DANGEROUS_PATTERNS.dataPackingPatterns.test(specStr)) {
    return { 
      blocked: true, 
      reason: 'Workflow sends encoded/packed data to temporary file sharing services.',
      dataFlow: 'external'
    };
  }
  
  // Determine data flow type
  let dataFlow: 'local' | 'external' | 'mixed' = 'local';
  const hasExternalTools = /"(gmail_send_message|outlook_send_mail|outlook_reply_message|outlook_forward_message|http_request|api_call)"/.test(specStr);
  const hasLocalTools = /"(click_at_coordinates|type_text|send_hotkey|wait|log)"/.test(specStr);
  
  if (hasExternalTools && hasLocalTools) {
    dataFlow = 'mixed';
  } else if (hasExternalTools) {
    dataFlow = 'external';
  }
  
  return { blocked: false, dataFlow };
}
