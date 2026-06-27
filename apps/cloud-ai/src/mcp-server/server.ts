/**
 * MCP Server — singleton
 *
 * One `MCPServer` instance holds the Stuard tools and serves the Streamable HTTP
 * transport for ALL users. There is no per-user state here: the caller's identity
 * and desktop WS are injected per-request via the bridge AsyncLocalStorage in
 * routes/mcp-server.ts. The transport keeps its own per-session state internally,
 * so the instance must be reused across requests.
 */

import { MCPServer } from '@mastra/mcp';
import { MCP_SERVER_TOOLS } from './tools';
import { buildWorkflowPrompts, buildWorkflowResources } from './skills/workflow-authoring';

let server: MCPServer | undefined;

export function getMcpServer(): MCPServer {
  if (!server) {
    server = new MCPServer({
      id: 'stuard',
      name: 'Stuard',
      version: '1.0.0',
      description:
        'Drive Stuard from your coding agent: read/write tasks, search memories and projects, inspect and create agents and workflows, discover and run any tool the main Stuard agent can run, and ask the user questions.',
      instructions: [
        'Use stuard_search_tools to discover what Stuard can do (tasks, memories, projects, agents, workflows, integrations, device actions), then stuard_execute_tool to run a tool by name.',
        'For long-running tools, pass background:true to stuard_execute_tool and poll the returned job_id with stuard_status.',
        'To build an automation workflow, YOU are the architect — compose the graph yourself: read the create_workflow prompt, ground with stuard_search_workflow_docs, find nodes with stuard_search_workflow_nodes (+ stuard_get_node_schema for exact args), then stuard_create_workflow to seed the spec and stuard_read_workflow / stuard_modify_workflow to build + validate it (stuard_read_workflow with validate:true). Use stuard_list_workflows to find an existing flow id to edit, and stuard_deploy_workflow to activate it so its triggers fire.',
        'Use stuard_ask to ask the human a question; it returns immediately with a job_id whose reply you poll with stuard_status.',
        'Device/desktop tools require the user\'s Stuard desktop app to be online.',
      ].join(' '),
      tools: MCP_SERVER_TOOLS,
      prompts: buildWorkflowPrompts(),
      resources: buildWorkflowResources(),
    });
  }
  return server;
}