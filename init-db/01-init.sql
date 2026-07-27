-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create vector similarity search function for cosine distance
CREATE OR REPLACE FUNCTION cosine_similarity(a vector, b vector) RETURNS float8 AS $$
  SELECT 1 - (a <=> b);
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;
