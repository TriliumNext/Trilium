import { Request, Response } from "express";
import sql from "../../services/sql.js";
import utils from "../../services/utils.js";

function getUsers(req: Request, res: Response) {
    const users = sql.getRows(`SELECT user_id AS userId, username FROM users`);
    return [200, users];
}

function createUser(req: Request, res: Response) {
    const username = req.body.username;
    if (!username) {
        return [400, { message: "username is required" }];
    }

    const userId = utils.randomString(10);
    
    try {
        sql.execute(`INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, 'NOT_YET_SETUP', 0)`, [userId, username]);
    } catch (e: any) {
        if (e.message.includes("UNIQUE constraint failed")) {
            return [400, { message: "Username already exists" }];
        }
        throw e;
    }

    return [201, { userId, username }];
}

export default {
    getUsers,
    createUser
};
