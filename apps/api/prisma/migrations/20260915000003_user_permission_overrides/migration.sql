-- Per-user permission overrides on top of roles (vendor access control): a GRANT adds a permission the
-- user's roles do not carry, a DENY removes one they do. Resolved in permission.service; every change
-- bumps users.permission_version so in-flight tokens re-resolve on their next request.
CREATE TYPE permission_override_effect AS ENUM ('GRANT', 'DENY');
CREATE TABLE user_permission_overrides (
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  permission_id  UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  effect         permission_override_effect NOT NULL,
  granted_by     UUID REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  note           TEXT,
  PRIMARY KEY (user_id, permission_id)
);
CREATE INDEX idx_user_permission_overrides_permission ON user_permission_overrides (permission_id);
