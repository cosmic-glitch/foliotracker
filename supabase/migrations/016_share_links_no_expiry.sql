-- Share links no longer expire: they last until the owner deletes them
-- (revoked_at). Already-expired links stay dead by being marked revoked at
-- their expiry time; every other live link loses its expiry date.
ALTER TABLE share_links ALTER COLUMN expires_at DROP NOT NULL;

UPDATE share_links
   SET revoked_at = expires_at
 WHERE revoked_at IS NULL
   AND expires_at IS NOT NULL
   AND expires_at <= now();

UPDATE share_links
   SET expires_at = NULL
 WHERE revoked_at IS NULL
   AND expires_at IS NOT NULL;
