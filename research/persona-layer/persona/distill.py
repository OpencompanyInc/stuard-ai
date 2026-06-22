"""Context distillation: turn the corpus into (question -> answer) examples
WITHOUT putting the corpus in the student's context.

Teacher = the RAG pipeline (model + corpus in context), which we know answers
correctly. We auto-generate questions FROM the corpus, have the teacher answer
them, and emit (question, answer) pairs. The LoRA student later learns to
produce those answers from the question ALONE -> the knowledge moves into
weights, so inference needs zero context tokens.

The generated questions are NOT the benchmark questions, so the eval still
measures genuine generalization of the baked-in knowledge (not memorized Qs).
"""

import re

QGEN_INSTRUCTION = (
    "Read the text and write {k} short, specific questions that the text answers. "
    "Mix questions a customer would ask with questions the business owner would "
    "ask about their own business. Output ONLY the questions, one per line, no "
    "numbering."
)

# Off-topic questions -> teacher (RAG) abstains -> student learns to NOT
# hallucinate facts that aren't in the corpus.
OFFTOPIC = [
    "What is the capital of France?",
    "How do I reset my Windows password?",
    "What's a good recipe for lasagna?",
    "Who won the World Cup in 2010?",
    "What is the boiling point of water?",
    "Can you write me a poem about the ocean?",
]


def _parse_questions(text):
    out = []
    for line in text.splitlines():
        line = re.sub(r"^\s*[-*\d.)]+\s*", "", line.strip())  # strip bullets/numbers
        if len(line) > 6 and line.endswith("?"):
            out.append(line)
    return out


def generate_questions(lm, persona, k_per_chunk=6, temperature=0.7):
    questions = []
    for chunk in persona.corpus.chunks:
        msgs = [
            {"role": "system", "content": QGEN_INSTRUCTION.format(k=k_per_chunk)},
            {"role": "user", "content": chunk},
        ]
        text, _ = lm.generate(msgs, max_new_tokens=200, temperature=temperature)
        questions.extend(_parse_questions(text))
    seen, uniq = set(), []
    for q in questions:
        key = q.lower()
        if key not in seen:
            seen.add(key)
            uniq.append(q)
    return uniq


def build_examples(lm, persona, k_per_chunk=6, include_abstain=True, verbose=True):
    """Returns list of {"question", "answer"} produced by the RAG teacher."""
    examples = []
    questions = generate_questions(lm, persona, k_per_chunk=k_per_chunk)
    if verbose:
        print(f"  generated {len(questions)} questions; querying teacher...")
    for q in questions:
        ans = persona.answer(q, mode="rag")["text"].strip()
        if ans:
            examples.append({"question": q, "answer": ans})
    if include_abstain:
        for q in OFFTOPIC:
            ans = persona.answer(q, mode="rag")["text"].strip()
            if ans:
                examples.append({"question": q, "answer": ans})
    return examples
