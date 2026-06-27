# Sub-Agent Test Cases

You can test the new autonomous sub-agent system using the Workflow Editor. Create a new workflow with a "Manual" trigger and add a `deploy_headless_agent` step.

## Case 1: Background Research (Fire & Forget)
**Objective:** Research a topic and summarize it while you continue working.

```json
{
  "id": "research_agent",
  "tool": "deploy_headless_agent",
  "args": {
    "objective": "Research the latest features in React 19 and summarize the key changes, especially regarding the compiler and server components.",
    "model": "smart",
    "tools_allowed": ["perplexity_search", "read_url_content"]
  }
}
```
**Verification:**
1. Run the workflow.
2. Go to the **Tasks** tab in the sidebar.
3. You should see a "Running" task.
4. Click it to view live logs (tool calls to perplexity, reasoning).
5. Wait for completion (green checkmark) and view the final summary.

## Case 2: Coding Assistant (File Operations)
**Objective:** Generate a utility script in the background.

```json
{
  "id": "coding_agent",
  "tool": "deploy_headless_agent",
  "args": {
    "objective": "Create a Python script named 'system_info.py' in the current directory that prints CPU and Memory usage using psutil. If psutil is missing, the script should try to install it or handle the error gracefully.",
    "model": "balanced",
    "tools_allowed": ["write_to_file", "run_python_script", "read_file", "list_directory"]
  }
}
```
**Verification:**
1. Run the workflow.
2. Monitor the task in the **Tasks** tab.
3. Watch it write the file and potentially test it.
4. Verify `system_info.py` appears in your workspace.

## Case 3: Data Analysis (Long Running)
**Objective:** Analyze a large log file or dataset (simulated).

```json
{
  "id": "analysis_agent",
  "tool": "deploy_headless_agent",
  "args": {
    "objective": "Analyze the last 50 lines of the application log (simulated) and identify any error patterns. Suggest fixes for each unique error type found.",
    "custom_system_prompt": "You are a senior DevOps engineer. Be concise and actionable.",
    "model": "fast"
  }
}
```
*Note: Ensure you have a log file or adjust the objective to read a real file.*

## Case 4: Multi-Agent Swarm (Parallel)
**Objective:** Spawn multiple agents at once.

```json
{
  "steps": [
    {
      "id": "agent_1",
      "tool": "deploy_headless_agent",
      "args": { "objective": "Find 3 interesting facts about Mars." }
    },
    {
      "id": "agent_2",
      "tool": "deploy_headless_agent",
      "args": { "objective": "Find 3 interesting facts about Venus." }
    }
  ]
}
```
**Verification:**
1. Run the workflow.
2. Go to **Tasks** tab.
3. You should see TWO agents running simultaneously.
4. Both will update their logs and complete independently.
