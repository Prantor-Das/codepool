-- Frozen deterministic fixture v1 for sandbox differential verification.
INSERT INTO accounts (id, balance) VALUES ('alice', 100), ('bob', 0);
INSERT INTO transfers (id, sender_id, recipient_id, amount, status)
VALUES ('transfer-1', 'alice', 'bob', 10, 'pending');
