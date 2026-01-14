import { randomString } from "./utils";

let instanceId: string | null = null;

export default function getInstanceId() {
    if (instanceId === null) {
        instanceId = randomString(12);
    }

    return instanceId;
}
