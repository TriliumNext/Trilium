import AttributeEditor from "./components/AttributeEditor";
import { TabContext } from "./ribbon-interface";

export default function OwnedAttributesTab({ note, ...restProps }: TabContext) {
    return (
        <div className="attribute-list">
            { note && (
                <AttributeEditor note={note} {...restProps} />
            )}
        </div>
    )
}