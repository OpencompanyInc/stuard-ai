from app.storage.memory_db import _serialize_vector


def test_serialize_vector_empty_list_is_null():
    assert _serialize_vector([]) is None
