## ADDED Requirements

### Requirement: Cache maps have a bounded maximum size
The cache (`this.cache`) and cache expiry (`this.cacheExpiry`) Maps in `RedmineAPI` and `ConfigManager` SHALL enforce a maximum entry count of `MAX_CACHE_SIZE` (100). When inserting a new entry would exceed this limit, the entry with the earliest expiry timestamp MUST be evicted first.

#### Scenario: Cache insertion within limit
- **WHEN** a new cache entry is set and the current cache size is below 100
- **THEN** the entry is stored without any eviction

#### Scenario: Cache insertion at limit
- **WHEN** a new cache entry is set and the current cache size has reached 100
- **THEN** the entry with the earliest expiry time is removed before the new entry is stored

#### Scenario: Cache hit after eviction
- **WHEN** a cache key has been evicted due to size limit
- **THEN** a subsequent `getFromCache()` call for that key returns null (cache miss)

### Requirement: Cache eviction does not affect valid unexpired entries beyond the oldest
The LRU eviction MUST remove only one entry per insertion (the entry with the smallest expiry value). All other entries SHALL remain accessible.

#### Scenario: Only one entry evicted per insertion
- **WHEN** the cache is at maximum capacity and one new entry is inserted
- **THEN** exactly one existing entry is removed and the new entry is stored
