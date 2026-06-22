"""Tone channel: Contrastive Activation Addition (CAA).

Given positive (on-tone) and negative (off-tone) example texts, we take the
mean residual-stream activation for each and use (mean_pos - mean_neg) per layer
as a steering direction. No gradient training -- just forward passes. At
generation time the direction is added to the residual stream via hooks.

The direction is unit-normalized per layer; at apply time it is scaled by a
fraction (`alpha`) of each token's own residual norm, so `alpha` is a clean,
model-agnostic knob (~0.05-0.3) instead of a raw magnitude that can detonate
the activations.
"""


def compute_steering(lm, pos_texts, neg_texts, layers):
    pos = _mean_acts(lm, pos_texts, layers)
    neg = _mean_acts(lm, neg_texts, layers)
    out = {}
    for L in layers:
        d = pos[L] - neg[L]
        out[L] = d / (d.norm() + 1e-6)  # unit direction; magnitude set at apply time
    return out


def _mean_acts(lm, texts, layers):
    sums = {L: None for L in layers}
    for text in texts:
        hs, mask = lm.hidden_states(text)
        keep = mask[0].bool()  # [seq] -- real (non-pad) tokens
        for L in layers:
            v = hs[L + 1][0][keep].mean(dim=0)  # mean over tokens, [hidden]
            sums[L] = v if sums[L] is None else sums[L] + v
    n = len(texts)
    return {L: sums[L] / n for L in layers}
