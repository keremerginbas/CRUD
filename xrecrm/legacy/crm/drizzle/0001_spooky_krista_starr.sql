CREATE TABLE `activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`type` enum('note','task','call','email','meeting','whatsapp','sms','form_submission') NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` longtext,
	`status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
	`dueDate` datetime,
	`reminderDate` datetime,
	`assignedToId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `aiCalls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`phoneNumber` varchar(20) NOT NULL,
	`externalCallId` varchar(255),
	`status` enum('pending','ringing','connected','completed','failed') NOT NULL DEFAULT 'pending',
	`duration` int,
	`recordingUrl` varchar(500),
	`transcriptText` longtext,
	`summary` longtext,
	`suggestedStatus` varchar(100),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiCalls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` datetime NOT NULL,
	`userId` int,
	`source` varchar(100),
	`statusId` int,
	`leadsCreated` int NOT NULL DEFAULT 0,
	`leadsConverted` int NOT NULL DEFAULT 0,
	`communicationsSent` int NOT NULL DEFAULT 0,
	`meetingsScheduled` int NOT NULL DEFAULT 0,
	`tasksCompleted` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assignmentRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`conditions` json NOT NULL,
	`assignToId` int NOT NULL,
	`priority` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assignmentRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`action` varchar(100) NOT NULL,
	`entityType` varchar(100) NOT NULL,
	`entityId` int,
	`changes` json,
	`ipAddress` varchar(45),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `communications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`type` enum('whatsapp','sms','email','phone','video_call') NOT NULL,
	`direction` enum('inbound','outbound') NOT NULL,
	`subject` varchar(255),
	`message` longtext,
	`senderPhone` varchar(20),
	`recipientPhone` varchar(20),
	`senderEmail` varchar(320),
	`recipientEmail` varchar(320),
	`externalId` varchar(255),
	`status` enum('sent','delivered','read','failed','pending') NOT NULL DEFAULT 'pending',
	`metadata` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `communications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `formSubmissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`formTemplateId` int NOT NULL,
	`leadId` int,
	`formData` json NOT NULL,
	`ipAddress` varchar(45),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `formSubmissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `formTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`fields` json NOT NULL,
	`embedCode` longtext,
	`successMessage` text,
	`redirectUrl` varchar(500),
	`createdBy` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `formTemplates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('whatcrm','netgsm','ercell','microsoft_graph','retell','zapier','email') NOT NULL,
	`name` varchar(255) NOT NULL,
	`apiKey` varchar(500) NOT NULL,
	`apiSecret` varchar(500),
	`apiUrl` varchar(500),
	`metadata` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`email` varchar(320),
	`phone` varchar(20),
	`projectName` varchar(200),
	`city` varchar(100),
	`source` varchar(100),
	`notes` longtext,
	`statusId` int NOT NULL,
	`assignedToId` int,
	`priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
	`lastContactDate` datetime,
	`nextFollowUpDate` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` longtext,
	`startTime` datetime NOT NULL,
	`endTime` datetime,
	`meetingLink` varchar(500),
	`meetingType` enum('video','phone','in_person') NOT NULL DEFAULT 'video',
	`participants` json,
	`recordingUrl` varchar(500),
	`notes` longtext,
	`organizerId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meetings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notificationPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`newLeadEmail` boolean NOT NULL DEFAULT true,
	`newLeadInApp` boolean NOT NULL DEFAULT true,
	`newLeadSMS` boolean NOT NULL DEFAULT false,
	`statusChangeEmail` boolean NOT NULL DEFAULT true,
	`statusChangeInApp` boolean NOT NULL DEFAULT true,
	`taskReminderEmail` boolean NOT NULL DEFAULT true,
	`taskReminderInApp` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notificationPreferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `statuses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`displayName` varchar(100) NOT NULL,
	`description` text,
	`color` varchar(7) NOT NULL DEFAULT '#3b82f6',
	`order` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `statuses_id` PRIMARY KEY(`id`),
	CONSTRAINT `statuses_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `transcriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`meetingId` int,
	`audioUrl` varchar(500) NOT NULL,
	`audioFileKey` varchar(255),
	`transcriptText` longtext,
	`summary` longtext,
	`suggestedStatus` varchar(100),
	`language` varchar(10) NOT NULL DEFAULT 'tr',
	`duration` int,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transcriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhookLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`webhookId` int NOT NULL,
	`event` varchar(100) NOT NULL,
	`payload` json NOT NULL,
	`response` json,
	`statusCode` int,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhookLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` varchar(500) NOT NULL,
	`events` json NOT NULL,
	`secret` varchar(255) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `webhooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','sales_manager','sales_rep','accountant') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `department` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;