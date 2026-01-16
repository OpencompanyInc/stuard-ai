-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create a table to store tool metadata and embeddings
create table if not exists tool_embeddings (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  category text,
  embedding vector(3072), -- matching text-embedding-3-large dimension
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create an index for faster similarity search using HNSW
-- Note: For small datasets (few hundred tools), an index might not strictly be necessary,
-- but it's good practice for scalability.
create index if not exists tool_embeddings_embedding_idx 
on tool_embeddings 
using hnsw (embedding vector_cosine_ops);














