"""
Knowledge Graph Tools

Exposes knowledge graph operations to the cloud-ai via the tool dispatch system.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import logging

from ..storage import knowledge_db as kdb

logger = logging.getLogger("agent")


async def knowledge_upsert_core(args: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert a core profile fact (overwrite behavior)."""
    key = str(args.get("key") or "").strip()
    value = str(args.get("value") or "").strip()
    vector = args.get("vector")

    if not key or not value:
        return {"ok": False, "error": "key and value are required"}

    try:
        fact = kdb.upsert_core_fact(
            attribute_key=key,
            text=value,
            vector=vector if isinstance(vector, list) else None,
            source=str(args.get("source", "ai_extracted")),
            confidence=float(args.get("confidence", 1.0)),
            source_conversation_id=args.get("source_conversation_id"),
        )
        return {"ok": True, "fact": fact.to_dict()}
    except Exception as e:
        logger.error(f"[knowledge] upsert_core error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_add_fact(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add a new fact (append behavior)."""
    category = str(args.get("category") or "").strip()
    subtype = str(args.get("subtype") or "").strip()
    text = str(args.get("text") or "").strip()
    entity_id = args.get("entity_id")
    attribute_key = args.get("attribute_key")
    vector = args.get("vector")
    source = str(args.get("source", "ai_extracted"))

    if not category or not subtype or not text:
        return {"ok": False, "error": "category, subtype, and text are required"}

    try:
        fact = kdb.append_fact(
            category=category,  # type: ignore
            subtype=subtype,  # type: ignore
            text=text,
            entity_id=str(entity_id) if entity_id else None,
            vector=vector if isinstance(vector, list) else None,
            source=source,
            confidence=float(args.get("confidence", 1.0)),
            source_conversation_id=args.get("source_conversation_id"),
        )
        return {"ok": True, "fact": fact.to_dict()}
    except Exception as e:
        logger.error(f"[knowledge] add_fact error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_upsert_procedural(args: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert a procedural fact (dedupe by key)."""
    key = str(args.get("key") or "").strip()
    value = str(args.get("value") or "").strip()
    entity_id = args.get("entity_id")
    vector = args.get("vector")
    
    if not key or not value:
        return {"ok": False, "error": "key and value are required"}
    
    try:
        fact = kdb.upsert_procedural_fact(
            attribute_key=key,
            text=value,
            entity_id=str(entity_id) if entity_id else None,
            vector=vector if isinstance(vector, list) else None
        )
        return {"ok": True, "fact": fact.to_dict()}
    except Exception as e:
        logger.error(f"[knowledge] upsert_procedural error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_create_entity(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new entity anchor."""
    name = str(args.get("name") or "").strip()
    entity_type = str(args.get("type") or "topic").strip()
    summary = str(args.get("summary") or "").strip()
    vector = args.get("vector")
    
    if not name:
        return {"ok": False, "error": "name is required"}
    
    try:
        # create_entity is idempotent (returns existing entity if present and may enrich it)
        entity = kdb.create_entity(
            name=name,
            entity_type=entity_type,  # type: ignore
            summary=summary,
            vector=vector if isinstance(vector, list) else None
        )
        return {"ok": True, "entity": entity.to_dict(), "id": entity.id}
    except Exception as e:
        logger.error(f"[knowledge] create_entity error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_find_entity(args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Find entity by name."""
    name = str(args.get("name") or "").strip()
    entity_type = args.get("type")
    
    if not name:
        return None
    
    try:
        entity = kdb.find_entity_by_name(
            name=name,
            entity_type=str(entity_type) if entity_type else None  # type: ignore
        )
        if entity:
            return {"ok": True, "id": entity.id, **entity.to_dict()}
        return None
    except Exception as e:
        logger.error(f"[knowledge] find_entity error: {e}")
        return None


async def knowledge_list_entities(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List all entities."""
    entity_type = args.get("type")
    limit = int(args.get("limit", 100))
    
    try:
        entities = kdb.list_entities(
            entity_type=str(entity_type) if entity_type else None,  # type: ignore
            limit=limit
        )
        return [e.to_dict() for e in entities]
    except Exception as e:
        logger.error(f"[knowledge] list_entities error: {e}")
        return []


async def knowledge_get_entity_context(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get entity and its linked facts by name."""
    name = str(args.get("name") or "").strip()
    limit = int(args.get("limit", 15))
    
    if not name:
        return {"entity": None, "facts": []}
    
    try:
        # Find entity by name
        entity = kdb.find_entity_by_name(name)
        if not entity:
            return {"entity": None, "facts": []}
        
        # Get context
        entity_obj, facts = kdb.get_entity_context(entity.id, limit=limit)
        if not entity_obj:
            return {"entity": None, "facts": []}
        
        return {
            "entity": entity_obj.to_dict(),
            "facts": [f.to_dict() for f in facts]
        }
    except Exception as e:
        logger.error(f"[knowledge] get_entity_context error: {e}")
        return {"entity": None, "facts": []}


async def knowledge_get_identity(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get identity lens (core profile facts)."""
    try:
        facts = kdb.get_identity_lens()
        return [f.to_dict() for f in facts]
    except Exception as e:
        logger.error(f"[knowledge] get_identity error: {e}")
        return []


async def knowledge_get_directives(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get directive lens (system instructions)."""
    try:
        facts = kdb.get_directive_lens()
        return [f.to_dict() for f in facts]
    except Exception as e:
        logger.error(f"[knowledge] get_directives error: {e}")
        return []


async def knowledge_get_bio(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get bio facts."""
    limit = int(args.get("limit", 20))
    
    try:
        facts = kdb.get_bio_facts(limit=limit)
        return [f.to_dict() for f in facts]
    except Exception as e:
        logger.error(f"[knowledge] get_bio error: {e}")
        return []


async def knowledge_search_facts(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Search facts by vector similarity."""
    vector = args.get("vector")
    limit = int(args.get("limit", 10))
    threshold = float(args.get("threshold", 0.65))
    category = args.get("category")
    entity_id = args.get("entity_id")
    include_vectors = bool(args.get("include_vectors", False))

    if not isinstance(vector, list) or len(vector) == 0:
        return []

    try:
        results = kdb.search_facts_by_vector(
            query_vector=vector,
            limit=limit,
            category=str(category) if category else None,  # type: ignore
            entity_id=str(entity_id) if entity_id else None,
            threshold=threshold,
            include_vectors=include_vectors,
        )
        out = []
        for f, s in results:
            d = f.to_dict()
            if include_vectors and f.vector:
                d['vector'] = f.vector
            out.append({"fact": d, "score": s})
        return out
    except Exception as e:
        logger.error(f"[knowledge] search_facts error: {e}")
        return []


async def knowledge_get_facts_for_conversation(args: Dict[str, Any]) -> Dict[str, Any]:
    """Return all facts extracted from a specific conversation."""
    conversation_id = str(args.get("conversation_id") or "").strip()
    if not conversation_id:
        return {"ok": False, "error": "conversation_id is required"}
    try:
        facts = kdb.get_facts_for_conversation(conversation_id)
        return {"ok": True, "facts": [f.to_dict() for f in facts]}
    except Exception as e:
        logger.error(f"[knowledge] get_facts_for_conversation error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_get_conversations_for_entity(args: Dict[str, Any]) -> Dict[str, Any]:
    """Return conversation IDs that produced facts for a given entity."""
    entity_id = str(args.get("entity_id") or "").strip()
    if not entity_id:
        return {"ok": False, "error": "entity_id is required"}
    try:
        conv_ids = kdb.get_conversations_for_entity(entity_id)
        return {"ok": True, "conversation_ids": conv_ids}
    except Exception as e:
        logger.error(f"[knowledge] get_conversations_for_entity error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_deduplicate_facts(args: Dict[str, Any]) -> Dict[str, Any]:
    """Run fact deduplication to remove near-duplicate entries."""
    threshold = float(args.get("threshold", 0.92))
    try:
        count = kdb.deduplicate_facts(similarity_threshold=threshold)
        return {"ok": True, "invalidated": count}
    except Exception as e:
        logger.error(f"[knowledge] deduplicate_facts error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get knowledge graph statistics."""
    try:
        return kdb.get_stats()
    except Exception as e:
        logger.error(f"[knowledge] stats error: {e}")
        return {"error": str(e)}


async def knowledge_delete_fact(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a fact by ID."""
    fact_id = str(args.get("id") or "").strip()
    
    if not fact_id:
        return {"ok": False, "error": "id is required"}
    
    try:
        deleted = kdb.delete_fact(fact_id)
        return {"ok": deleted}
    except Exception as e:
        logger.error(f"[knowledge] delete_fact error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_invalidate_fact(args: Dict[str, Any]) -> Dict[str, Any]:
    """Mark a fact as invalid/deprecated."""
    fact_id = str(args.get("id") or "").strip()
    
    if not fact_id:
        return {"ok": False, "error": "id is required"}
    
    try:
        invalidated = kdb.invalidate_fact(fact_id)
        return {"ok": invalidated}
    except Exception as e:
        logger.error(f"[knowledge] invalidate_fact error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_delete_entity(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete an entity and all its linked facts."""
    entity_id = str(args.get("id") or "").strip()
    
    if not entity_id:
        return {"ok": False, "error": "id is required"}
    
    try:
        deleted = kdb.delete_entity(entity_id)
        return {"ok": deleted}
    except Exception as e:
        logger.error(f"[knowledge] delete_entity error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_update_entity(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update an entity."""
    entity_id = str(args.get("id") or "").strip()
    
    if not entity_id:
        return {"ok": False, "error": "id is required"}
    
    try:
        entity = kdb.update_entity(
            entity_id=entity_id,
            name=args.get("name"),
            summary=args.get("summary"),
            vector=args.get("vector") if isinstance(args.get("vector"), list) else None
        )
        if entity:
            return {"ok": True, "entity": entity.to_dict()}
        return {"ok": False, "error": "Entity not found"}
    except Exception as e:
        logger.error(f"[knowledge] update_entity error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_build_context(args: Dict[str, Any]) -> Dict[str, Any]:
    """Build context block for LLM injection (local version without vector search)."""
    detected_entity = args.get("detected_entity")
    include_identity = args.get("include_identity", True)
    include_directives = args.get("include_directives", True)
    include_bio = args.get("include_bio", False)
    
    try:
        context = kdb.build_context_block(
            query_vector=None,  # No vector search in local version
            detected_entity_name=str(detected_entity) if detected_entity else None,
            include_identity=bool(include_identity),
            include_directives=bool(include_directives),
            include_bio=bool(include_bio),
            max_global_facts=0
        )
        return {"ok": True, "context": context}
    except Exception as e:
        logger.error(f"[knowledge] build_context error: {e}")
        return {"ok": False, "error": str(e), "context": ""}


async def knowledge_get_procedural(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get procedural snippets."""
    entity_id = args.get("entity_id")
    limit = int(args.get("limit", 20))
    
    try:
        facts = kdb.get_procedural_facts(
            entity_id=str(entity_id) if entity_id else None,
            limit=limit
        )
        return [f.to_dict() for f in facts]
    except Exception as e:
        logger.error(f"[knowledge] get_procedural error: {e}")
        return []


async def knowledge_get_events(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get event history."""
    limit = int(args.get("limit", 50))
    
    try:
        facts = kdb.get_event_history(limit=limit)
        return [f.to_dict() for f in facts]
    except Exception as e:
        logger.error(f"[knowledge] get_events error: {e}")
        return []


async def pending_memory_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a pending memory that needs user confirmation."""
    original_text = str(args.get("original_text") or "").strip()
    proposed_action = str(args.get("proposed_action") or "").strip()
    proposed_value = str(args.get("proposed_value") or "").strip()
    confidence_reason = str(args.get("confidence_reason") or "").strip()
    proposed_key = args.get("proposed_key")
    entity_name = args.get("entity_name")

    if not original_text or not proposed_action or not proposed_value or not confidence_reason:
        return {"ok": False, "error": "original_text, proposed_action, proposed_value, and confidence_reason are required"}

    try:
        pending = kdb.create_pending_memory(
            original_text=original_text,
            proposed_action=proposed_action,
            proposed_value=proposed_value,
            confidence_reason=confidence_reason,
            proposed_key=str(proposed_key) if proposed_key else None,
            entity_name=str(entity_name) if entity_name else None
        )
        return {"ok": True, "pending": pending.to_dict()}
    except Exception as e:
        logger.error(f"[knowledge] pending_memory_create error: {e}")
        return {"ok": False, "error": str(e)}


async def pending_memory_list(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get all pending memories awaiting confirmation."""
    limit = int(args.get("limit", 20))

    try:
        pending = kdb.get_pending_memories(limit=limit)
        return [p.to_dict() for p in pending]
    except Exception as e:
        logger.error(f"[knowledge] pending_memory_list error: {e}")
        return []


async def pending_memory_get(args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Get a specific pending memory by ID."""
    pending_id = str(args.get("id") or "").strip()

    if not pending_id:
        return None

    try:
        pending = kdb.get_pending_memory(pending_id)
        if pending:
            return pending.to_dict()
        return None
    except Exception as e:
        logger.error(f"[knowledge] pending_memory_get error: {e}")
        return None


async def pending_memory_confirm(args: Dict[str, Any]) -> Dict[str, Any]:
    """Confirm a pending memory and add it to main memory."""
    pending_id = str(args.get("id") or "").strip()

    if not pending_id:
        return {"ok": False, "error": "id is required"}

    try:
        # Get the pending memory first
        pending = kdb.get_pending_memory(pending_id)
        if not pending:
            return {"ok": False, "error": "Pending memory not found"}

        if pending.status != 'pending':
            return {"ok": False, "error": f"Memory already {pending.status}"}

        # Mark as confirmed
        confirmed = kdb.confirm_pending_memory(pending_id)
        if not confirmed:
            return {"ok": False, "error": "Failed to confirm"}

        return {"ok": True, "message": "Memory confirmed, ready for processing"}
    except Exception as e:
        logger.error(f"[knowledge] pending_memory_confirm error: {e}")
        return {"ok": False, "error": str(e)}


async def pending_memory_reject(args: Dict[str, Any]) -> Dict[str, Any]:
    """Reject a pending memory (will not be stored)."""
    pending_id = str(args.get("id") or "").strip()

    if not pending_id:
        return {"ok": False, "error": "id is required"}

    try:
        rejected = kdb.reject_pending_memory(pending_id)
        return {"ok": rejected}
    except Exception as e:
        logger.error(f"[knowledge] pending_memory_reject error: {e}")
        return {"ok": False, "error": str(e)}


async def pending_memory_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Permanently delete a pending memory."""
    pending_id = str(args.get("id") or "").strip()

    if not pending_id:
        return {"ok": False, "error": "id is required"}

    try:
        deleted = kdb.delete_pending_memory(pending_id)
        return {"ok": deleted}
    except Exception as e:
        logger.error(f"[knowledge] pending_memory_delete error: {e}")
        return {"ok": False, "error": str(e)}


async def knowledge_get_graph(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get the knowledge graph (nodes and edges)."""
    limit = int(args.get("limit", 100))
    threshold = float(args.get("threshold", 0.7))
    
    try:
        # Get entities (nodes)
        entities = kdb.list_entities(limit=limit)
        nodes = []
        vectors = []
        
        for e in entities:
            # e.vector is available on the object
            nodes.append(e.to_dict())
            vectors.append(e.vector)
            
        import numpy as np
        import random
        import math
        
        # Calculate edges based on vector similarity
        edges = []
        
        # Only calculate edges if we have vectors
        if vectors and len(vectors) > 0:
            vec_matrix = np.array([v if v else np.zeros(kdb.VECTOR_DIM) for v in vectors], dtype=np.float32)
            
            # --- Per-Topic Grouping & Local PCA ---
            try:
                # 1. Identify Topics vs Others
                topic_indices = [i for i, n in enumerate(nodes) if n['type'] == 'topic']
                other_indices = [i for i, n in enumerate(nodes) if n['type'] != 'topic']
                
                # 2. Group others by their best topic
                groups = {t_idx: [] for t_idx in topic_indices}
                groups[-1] = [] # General group
                
                if topic_indices:
                    # Calculate similarities to topics
                    # Pre-calculate topic norms
                    topic_norms = [np.linalg.norm(vec_matrix[t_idx]) for t_idx in topic_indices]
                    
                    for o_idx in other_indices:
                        if not vectors[o_idx]:
                            groups[-1].append(o_idx)
                            continue
                            
                        best_score = -1.0
                        best_topic = -1
                        
                        o_vec = vec_matrix[o_idx]
                        o_norm = np.linalg.norm(o_vec)
                        
                        if o_norm == 0:
                            groups[-1].append(o_idx)
                            continue

                        for i, t_idx in enumerate(topic_indices):
                            if not vectors[t_idx]: continue
                            t_vec = vec_matrix[t_idx]
                            t_norm = topic_norms[i]
                            
                            score = float(np.dot(o_vec, t_vec) / (o_norm * t_norm)) if t_norm > 0 else 0.0
                            if score > best_score:
                                best_score = score
                                best_topic = t_idx
                        
                        # Use a reasonable threshold to assign to a topic
                        if best_score >= (threshold * 0.8): 
                            groups[best_topic].append(o_idx)
                        else:
                            groups[-1].append(o_idx)
                else:
                    groups[-1] = other_indices
                
                # 3. Position Groups in a Grid
                active_topic_indices = [t for t in topic_indices]
                if groups[-1]:
                    active_topic_indices.append(-1)
                
                num_active = len(active_topic_indices)
                cols = math.ceil(math.sqrt(num_active)) if num_active > 0 else 1
                spacing_x = 1000
                spacing_y = 1000
                
                for i, t_idx in enumerate(active_topic_indices):
                    # Center of this topic's area
                    gx = (i % cols) * spacing_x
                    gy = (i // cols) * spacing_y
                    
                    if t_idx >= 0:
                        # Topic Header node
                        nodes[t_idx]['x'] = gx
                        nodes[t_idx]['y'] = gy
                        # Use fx/fy to pin the topic as a header
                        nodes[t_idx]['fx'] = gx
                        nodes[t_idx]['fy'] = gy
                    
                    # Perform Local PCA for group members
                    member_indices = groups[t_idx]
                    if not member_indices: continue
                    
                    if len(member_indices) >= 2:
                        try:
                            # Sub-set of vectors for members
                            m_vectors = vec_matrix[member_indices]
                            m_mean = np.mean(m_vectors, axis=0)
                            m_centered = m_vectors - m_mean
                            
                            # PCA via SVD
                            U, S, Vt = np.linalg.svd(m_centered, full_matrices=False)
                            # Projection
                            coords = U[:, :2] * S[:2]
                            
                            # Scale the local cluster
                            max_val = np.max(np.abs(coords))
                            scale = 350 # Radius of the cluster
                            if max_val > 0:
                                coords = coords / max_val * scale
                            
                            for j, m_idx in enumerate(member_indices):
                                # Position nodes relative to topic center
                                # Offset y slightly to put them below the title
                                nodes[m_idx]['x'] = gx + float(coords[j][0])
                                nodes[m_idx]['y'] = gy + float(coords[j][1]) + 150 
                        except Exception as e:
                            logger.warning(f"[knowledge] Local PCA failed for group {t_idx}: {e}")
                            # Jitter fallback
                            for m_idx in member_indices:
                                nodes[m_idx]['x'] = gx + random.uniform(-200, 200)
                                nodes[m_idx]['y'] = gy + random.uniform(100, 300)
                    else:
                        # Single or no members
                        for m_idx in member_indices:
                            nodes[m_idx]['x'] = gx
                            nodes[m_idx]['y'] = gy + 200
            except Exception as global_pca_err:
                logger.warning(f"[knowledge] Grouped PCA failed: {global_pca_err}")
            
            # --- Edge Calculation ---
            # We still calculate all edges that meet threshold, regardless of group
            # This allows cross-topic connections to be visible as "red strings"
            norms = np.linalg.norm(vec_matrix, axis=1)
            norms[norms == 0] = 1.0
            
            for i in range(len(nodes)):
                for j in range(i + 1, len(nodes)):
                    if not vectors[i] or not vectors[j]: continue
                    
                    dot = np.dot(vec_matrix[i], vec_matrix[j])
                    score = float(dot / (norms[i] * norms[j]))
                    
                    if score >= threshold:
                        edges.append({
                            "source": nodes[i]["id"],
                            "target": nodes[j]["id"],
                            "value": score
                        })
                    
        return {
            "ok": True,
            "nodes": nodes,
            "edges": edges
        }
    except Exception as e:
        logger.error(f"[knowledge] get_graph error: {e}")
        return {"ok": False, "error": str(e), "nodes": [], "edges": []}
