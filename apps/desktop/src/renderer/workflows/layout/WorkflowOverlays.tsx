import React from "react";
import {
  MarketplaceBrowser,
  MyPublishedWorkflowsModal,
  PublishModal,
  WorkflowUpdateModal,
} from "../components/MarketplaceModal";
import { DeployPanelModal } from "../components/DeployPanelModal";
import { ImportJsonModal } from "../components/ImportJsonModal";
import type { DesignerModel } from "../types";
import type { CloudVM, CloudDeployState } from "../hooks/useWorkflowDeploy";
import type { WorkflowContextMenu } from "./types";
import { WorkflowContextMenuOverlay } from "./WorkflowContextMenu";
import type { MarketplaceUpdate } from "../../utils/cloud";

interface WorkflowOverlaysProps {
  contextMenu: WorkflowContextMenu | null;
  model: DesignerModel | null;
  selectedNodeIds: Set<string>;
  onCloseContextMenu: () => void;
  onRunStep: (nodeId: string) => void;
  onRunFromHere: (nodeId: string) => void;
  onDuplicateNode: () => void;
  onCopyNodes: () => void;
  onCutNodes: () => void;
  onPasteNodes: () => void;
  onDeleteNode: () => void;
  onStartReconnect: (wireIndex: number, end: "from" | "to") => void;
  onEditWire: (wireIndex: number) => void;
  onDeleteWire: (wireIndex: number) => void;
  onAutoOrganize: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  showDeployPanel: boolean;
  deployStatus: { deployed: boolean; running: boolean; triggers: string[] } | null;
  onCloseDeployPanel: () => void;
  onDeploy: () => void;
  onUndeploy: () => void;
  onExport: () => void;
  onOpenPublish: () => void;
  // Cloud deploy
  cloudVMs: CloudVM[];
  selectedVM: string | null;
  onSelectVM: (vmId: string) => void;
  cloudDeployState: CloudDeployState;
  cloudDeployError: string | null;
  cloudDeployId: string | null;
  onDeployToCloud: (vmId?: string) => void;
  onResetCloudDeploy: () => void;
  showImport: boolean;
  importJson: string;
  setImportJson: (value: string) => void;
  importErr: string;
  onCloseImport: () => void;
  onOpenMarketplaceFromImport: () => void;
  onImportJson: () => Promise<void>;
  showPublish: boolean;
  onClosePublish: () => void;
  showMarketplace: boolean;
  marketplaceSlug?: string;
  onCloseMarketplace: () => void;
  onImportMarketplace: (slug: string) => Promise<void>;
  showMyPublished: boolean;
  onCloseMyPublished: () => void;
  onOpenPublishFromMyPublished: () => void;
  pendingUpdate: { id: string; update: MarketplaceUpdate } | null;
  currentUpdateWorkflowName?: string;
  onClosePendingUpdate: () => void;
  onApplyPendingUpdate: () => Promise<void>;
}

export function WorkflowOverlays({
  contextMenu,
  model,
  selectedNodeIds,
  onCloseContextMenu,
  onRunStep,
  onRunFromHere,
  onDuplicateNode,
  onCopyNodes,
  onCutNodes,
  onPasteNodes,
  onDeleteNode,
  onStartReconnect,
  onEditWire,
  onDeleteWire,
  onAutoOrganize,
  onZoomReset,
  onZoomIn,
  onZoomOut,
  showDeployPanel,
  deployStatus,
  onCloseDeployPanel,
  onDeploy,
  onUndeploy,
  onExport,
  onOpenPublish,
  cloudVMs,
  selectedVM,
  onSelectVM,
  cloudDeployState,
  cloudDeployError,
  cloudDeployId,
  onDeployToCloud,
  onResetCloudDeploy,
  showImport,
  importJson,
  setImportJson,
  importErr,
  onCloseImport,
  onOpenMarketplaceFromImport,
  onImportJson,
  showPublish,
  onClosePublish,
  showMarketplace,
  marketplaceSlug,
  onCloseMarketplace,
  onImportMarketplace,
  showMyPublished,
  onCloseMyPublished,
  onOpenPublishFromMyPublished,
  pendingUpdate,
  currentUpdateWorkflowName,
  onClosePendingUpdate,
  onApplyPendingUpdate,
}: WorkflowOverlaysProps) {
  return (
    <>
      <WorkflowContextMenuOverlay
        contextMenu={contextMenu}
        model={model}
        selectedNodeIds={selectedNodeIds}
        onClose={onCloseContextMenu}
        onRunStep={onRunStep}
        onRunFromHere={onRunFromHere}
        onDuplicateNode={onDuplicateNode}
        onCopyNodes={onCopyNodes}
        onCutNodes={onCutNodes}
        onPasteNodes={onPasteNodes}
        onDeleteNode={onDeleteNode}
        onStartReconnect={onStartReconnect}
        onEditWire={onEditWire}
        onDeleteWire={onDeleteWire}
        onAutoOrganize={onAutoOrganize}
        onZoomReset={onZoomReset}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />

      {showDeployPanel && model && (
        <DeployPanelModal
          model={model}
          deployStatus={deployStatus}
          onClose={onCloseDeployPanel}
          onDeploy={onDeploy}
          onUndeploy={onUndeploy}
          onExport={onExport}
          onPublish={onOpenPublish}
          cloudVMs={cloudVMs}
          selectedVM={selectedVM}
          onSelectVM={onSelectVM}
          cloudDeployState={cloudDeployState}
          cloudDeployError={cloudDeployError}
          cloudDeployId={cloudDeployId}
          onDeployToCloud={onDeployToCloud}
          onResetCloudDeploy={onResetCloudDeploy}
        />
      )}

      {showImport && (
        <ImportJsonModal
          importJson={importJson}
          setImportJson={setImportJson}
          importErr={importErr}
          onClose={onCloseImport}
          onOpenMarketplace={onOpenMarketplaceFromImport}
          onImport={onImportJson}
        />
      )}

      {showPublish && model && (
        <PublishModal
          model={model}
          onClose={onClosePublish}
          onSuccess={() => {
            // no-op
          }}
        />
      )}

      {showMarketplace && (
        <MarketplaceBrowser
          onClose={onCloseMarketplace}
          onImport={onImportMarketplace}
          initialSlug={marketplaceSlug}
        />
      )}

      {showMyPublished && (
        <MyPublishedWorkflowsModal
          onClose={onCloseMyPublished}
          onUpdateWorkflow={() => {
            onOpenPublishFromMyPublished();
          }}
        />
      )}

      {pendingUpdate && (
        <WorkflowUpdateModal
          update={pendingUpdate.update}
          currentWorkflowName={currentUpdateWorkflowName || pendingUpdate.id}
          onClose={onClosePendingUpdate}
          onUpdate={onApplyPendingUpdate}
        />
      )}
    </>
  );
}
