import crypto from "crypto";
import SNote from "./snote";
import utils from "../../../services/utils";

const DefaultAccessTimeoutSec = 10 * 60; // 10 minutes

export class ContentAccessor {
    note: SNote;
    token: string;
    timestamp: number;
    type: string;
    timeout: number;
    key: Buffer;

    constructor(note: SNote) {
        this.note = note;
        this.key = crypto.randomBytes(32);
        this.token = "";
        this.timestamp = 0;
        this.timeout = Number(this.note.getAttributeValue("label", "shareAccessTokenTimeout") || DefaultAccessTimeoutSec)

        switch (this.note.getAttributeValue("label", "shareContentAccess")) {
            case "basic": this.type = "basic"; break
            case "query": this.type = "query"; break
            default: this.type = "cookie"; break
        };

    }

    __encrypt(text: string) {
        const iv = crypto.randomBytes(16); 
        const cipher = crypto.createCipheriv('aes-256-cbc', this.key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + encrypted; 
    }

    __decrypt(encryptedText: string) {
        try {
            const iv = Buffer.from(encryptedText.slice(0, 32), 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
            let decrypted = decipher.update(encryptedText.slice(32), 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch {
            return ""
        }
    }

    __compare(originalText: string, encryptedText: string) {
        return originalText === this.__decrypt(encryptedText)
    }

    update() {
        if (new Date().getTime() < this.timestamp + this.getTimeout() * 1000) return
        this.token = utils.randomString(36);
        this.key = crypto.randomBytes(32);
        this.timestamp = new Date().getTime();
    }

    isTokenValid(encToken: string) {
        return this.__compare(this.token, encToken) && new Date().getTime() < this.timestamp + this.getTimeout() * 1000;
    }

    getToken() {
        return this.__encrypt(this.token);
    }

    getTokenExpiration() {
        return (this.timestamp + (this.timeout * 1000) - new Date().getTime()) /1000;
    }
    
    getTimeout() {
        return this.timeout;
    }

    getContentAccessType() {
       return this.type;
    }

}