-- Base Service seed. Runs ONLY when the database is empty (no bases yet).
-- Every seeded player starts with one base in the FAF Cab.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bases) THEN
    RAISE NOTICE 'base-service: database already has data, seed skipped';
    RETURN;
  END IF;

  INSERT INTO bases (id, player_id, name, room_id, level, storage_capacity) VALUES
    ('base-player-1', 'player-1', 'FAF Cab', 'FAF_CAB', 1, 100),
    ('base-player-2', 'player-2', 'FAF Cab', 'FAF_CAB', 1, 100),
    ('base-player-3', 'player-3', 'FAF Cab', 'FAF_CAB', 1, 100);

  RAISE NOTICE 'base-service: seed applied';
END $$;
