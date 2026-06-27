import { describe, expect, it } from "vitest";

import { collectWorkflowDependencies } from "@stuardai/workflow-core/dependencies";
import { detectReferencedFiles } from "./workspaceReferences";

describe("collectWorkflowDependencies", () => {
  it("collects + de-dupes python packages across nodes and the top-level requirements", () => {
    const spec = {
      requirements: "rich==13.0",
      nodes: [
        { id: "a", tool: "local.python_install", args: { packages: ["pandas==2.1.0", "numpy"] } },
        { id: "b", tool: "local.run_python_script", args: { packages: ["numpy", "pillow"], code: "..." } },
        { id: "c", tool: "local.log", args: { message: "hi" } },
      ],
    };
    const deps = collectWorkflowDependencies(spec);
    expect(deps.python.packages).toEqual(["pandas==2.1.0", "numpy", "pillow"]);
    expect(deps.python.requirementsTxt).toBe("rich==13.0");
  });

  it("accepts a comma-separated packages string and normalizes the tool prefix", () => {
    const spec = {
      nodes: [{ id: "a", tool: "run_python_script", args: { packages: "requests, httpx ,," } }],
    };
    const deps = collectWorkflowDependencies(spec);
    expect(deps.python.packages).toEqual(["requests", "httpx"]);
  });

  it("merges multiple requirementsTxt blocks and returns empty for a no-dep spec", () => {
    expect(collectWorkflowDependencies({ nodes: [{ tool: "local.log", args: {} }] }).python.packages).toEqual([]);
    const merged = collectWorkflowDependencies({
      nodes: [
        { tool: "local.python_install", args: { requirementsTxt: "a==1" } },
        { tool: "local.run_python_script", args: { requirementsTxt: "b==2" } },
      ],
    });
    expect(merged.python.requirementsTxt).toBe("a==1\nb==2");
  });
});

describe("detectReferencedFiles", () => {
  const candidates = [
    "scripts/process.py",
    "imported/sub.stuard",
    "assets/logo.png",
    "assets/vacation.jpg",
    "data/secret.txt",
  ];

  const spec = {
    nodes: [
      { id: "n1", tool: "local.run_python_script", args: { code: "open('scripts/process.py')" } },
      { id: "n2", tool: "local.call_workspace_function", args: { path: "imported/sub.stuard" } },
    ],
  };

  it("selects referenced files and excludes unreferenced personal media", async () => {
    const { referenced } = await detectReferencedFiles(spec, candidates);
    expect(referenced.has("scripts/process.py")).toBe(true);
    expect(referenced.has("imported/sub.stuard")).toBe(true);
    // No transitive reader → logo.png (only referenced inside the sub-workflow) stays out.
    expect(referenced.has("assets/logo.png")).toBe(false);
    // Never referenced anywhere.
    expect(referenced.has("assets/vacation.jpg")).toBe(false);
    expect(referenced.has("data/secret.txt")).toBe(false);
  });

  it("resolves files referenced transitively through a .stuard sub-workflow", async () => {
    const readStuard = async (p: string) =>
      p === "imported/sub.stuard"
        ? JSON.stringify({ nodes: [{ tool: "local.run_python_script", args: { code: "logo='assets/logo.png'" } }] })
        : null;
    const { referenced, reasonByPath } = await detectReferencedFiles(spec, candidates, readStuard);
    expect(referenced.has("assets/logo.png")).toBe(true);
    expect(reasonByPath.get("assets/logo.png")).toMatch(/sub\.stuard/);
    // Personal files still excluded after transitive closure.
    expect(referenced.has("assets/vacation.jpg")).toBe(false);
  });

  it("attributes a referenced file to the node that mentions it", async () => {
    const { reasonByPath } = await detectReferencedFiles(spec, candidates);
    expect(reasonByPath.get("scripts/process.py")).toBe("referenced by node n1");
  });
});
