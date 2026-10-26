CREATE TABLE IF NOT EXISTS parcels (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 province VARCHAR(100) NOT NULL,district VARCHAR(100) NOT NULL,neighborhood VARCHAR(150) NOT NULL,
 block_no VARCHAR(40) NOT NULL,parcel_no VARCHAR(40) NOT NULL,
 geometry JSON NULL, area_m2 DECIMAL(15,2) NULL, qualification VARCHAR(120) NULL, sheet VARCHAR(60) NULL, source_name VARCHAR(120) NULL, source_checked_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uniq_parcel (province,district,neighborhood,block_no,parcel_no)
);
CREATE TABLE IF NOT EXISTS map_markers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(100) NOT NULL DEFAULT 'local',
 parcel_id BIGINT UNSIGNED NULL,lat DOUBLE NOT NULL,lng DOUBLE NOT NULL,note TEXT NULL,
 color VARCHAR(20) NOT NULL DEFAULT 'red',is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_map_user(user_id), INDEX idx_map_favorite(user_id,is_favorite),
 FOREIGN KEY(parcel_id) REFERENCES parcels(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS query_jobs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, parcel_id BIGINT UNSIGNED NOT NULL,
 status ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
 error_message TEXT NULL, attempts INT NOT NULL DEFAULT 0,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(parcel_id) REFERENCES parcels(id)
);
CREATE TABLE IF NOT EXISTS ai_analyses (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,parcel_id BIGINT UNSIGNED NULL,
 marker_id BIGINT UNSIGNED NULL, analysis LONGTEXT NOT NULL,context_json JSON NULL,
 model VARCHAR(100),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(parcel_id) REFERENCES parcels(id) ON DELETE SET NULL,
 FOREIGN KEY(marker_id) REFERENCES map_markers(id) ON DELETE SET NULL
);
-- V13: emsal ilanlar (İlan5 eklentisinden içe aktarılır; satıcı adı/telefon saklanmaz)
CREATE TABLE IF NOT EXISTS comparables (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, source VARCHAR(40) NOT NULL, listing_id VARCHAR(80) NOT NULL,
 title VARCHAR(500) NULL, price DECIMAL(18,2) NULL, currency VARCHAR(8) NULL, area DECIMAL(15,2) NULL,
 city VARCHAR(100) NULL, district VARCHAR(100) NULL, neighborhood VARCHAR(150) NULL,
 city_key VARCHAR(100) NULL, district_key VARCHAR(100) NULL, neighborhood_key VARCHAR(150) NULL,
 category VARCHAR(20) NULL, url VARCHAR(1000) NULL, imar VARCHAR(200) NULL, kaks VARCHAR(60) NULL, tapu VARCHAR(120) NULL,
 ada_parsel VARCHAR(80) NULL, listing_status VARCHAR(20) NULL, captured_at VARCHAR(40) NULL,
 imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uniq_listing (source,listing_id), INDEX idx_area(city_key,district_key,neighborhood_key)
);
-- V13 yükseltmesi (mevcut MySQL kurulumları için bir kez çalıştırın):
-- ALTER TABLE parcels ADD COLUMN qualification VARCHAR(120) NULL, ADD COLUMN sheet VARCHAR(60) NULL;
