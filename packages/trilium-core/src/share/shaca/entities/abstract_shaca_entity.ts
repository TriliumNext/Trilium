import shaca from "../shaca.js";
import type Shaca from "../shaca-interface.js";

class AbstractShacaEntity {
    get shaca(): Shaca {
        return shaca;
    }
}

export default AbstractShacaEntity;
