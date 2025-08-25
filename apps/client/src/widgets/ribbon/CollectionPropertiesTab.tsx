import { useContext, useMemo } from "preact/hooks";
import { t } from "../../services/i18n";
import { ViewTypeOptions } from "../../services/note_list_renderer";
import FormSelect, { FormSelectWithGroups } from "../react/FormSelect";
import { TabContext } from "./ribbon-interface";
import { mapToKeyValueArray } from "../../services/utils";
import { useNoteLabel, useNoteLabelBoolean } from "../react/hooks";
import { bookPropertiesConfig, BookProperty, ButtonProperty, CheckBoxProperty, ComboBoxProperty, NumberProperty } from "./collection-properties-config";
import Button from "../react/Button";
import { ParentComponent } from "../react/react_utils";
import FNote from "../../entities/fnote";
import FormCheckbox from "../react/FormCheckbox";
import FormTextBox from "../react/FormTextBox";
import { ComponentChildren } from "preact";

const VIEW_TYPE_MAPPINGS: Record<ViewTypeOptions, string> = {
  grid: t("book_properties.grid"),
  list: t("book_properties.list"),
  calendar: t("book_properties.calendar"),
  table: t("book_properties.table"),
  geoMap: t("book_properties.geo-map"),
  board: t("book_properties.board")
};

export default function CollectionPropertiesTab({ note }: TabContext) {
  const [ viewType, setViewType ] = useNoteLabel(note, "viewType");
  const viewTypeWithDefault = viewType ?? "grid";
  const properties = bookPropertiesConfig[viewTypeWithDefault].properties;

  return (
    <div className="book-properties-widget">
      {note && (
        <>
          <CollectionTypeSwitcher viewType={viewTypeWithDefault} setViewType={setViewType} />
          <BookProperties note={note} properties={properties} />
        </>
      )}
    </div>
  );
}

function CollectionTypeSwitcher({ viewType, setViewType }: { viewType: string, setViewType: (newValue: string) => void }) {
  const collectionTypes = useMemo(() => mapToKeyValueArray(VIEW_TYPE_MAPPINGS), []);

  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
        <span style={{ whiteSpace: "nowrap" }}>{t("book_properties.view_type")}:&nbsp; &nbsp;</span>
        <FormSelect
          currentValue={viewType ?? "grid"} onChange={setViewType}
          values={collectionTypes}
          keyProperty="key" titleProperty="value"
        />
    </div>
  )
}

function BookProperties({ note, properties }: { note: FNote, properties: BookProperty[] }) {
  return (
    <div className="book-properties-container">
      {properties.map(property => (
        <div className={`type-${property}`}>
          {mapPropertyView({ note, property })}
        </div>
      ))}
    </div>
  )
}

function mapPropertyView({ note, property }: { note: FNote, property: BookProperty }) {
  switch (property.type) {
    case "button":
      return <ButtonPropertyView note={note} property={property} />
    case "checkbox":
      return <CheckboxPropertyView note={note} property={property} />
    case "number":
      return <NumberPropertyView note={note} property={property} />
    case "combobox":
      return <ComboBoxPropertyView note={note} property={property} />
  }
}

function ButtonPropertyView({ note, property }: { note: FNote, property: ButtonProperty }) {
  const parentComponent = useContext(ParentComponent);

  return <Button
    text={property.label}
    title={property.title}
    icon={property.icon}
    onClick={() => {
      if (!parentComponent) return;
      property.onClick({
        note,
        triggerCommand: parentComponent.triggerCommand.bind(parentComponent)
    });
    }}
  />
}

function CheckboxPropertyView({ note, property }: { note: FNote, property: CheckBoxProperty }) {
  const [ value, setValue ] = useNoteLabelBoolean(note, property.bindToLabel);

  return (
    <FormCheckbox
      label={property.label}
      currentValue={value} onChange={setValue}
    />
  )
}

function NumberPropertyView({ note, property }: { note: FNote, property: NumberProperty }) {
    const [ value, setValue ] = useNoteLabel(note, property.bindToLabel);

    return (
        <LabelledEntry label={property.label}>
            <FormTextBox
                type="number"
                currentValue={value ?? ""} onChange={setValue}
                style={{ width: (property.width ?? 100) + "px" }}
                min={property.min ?? 0}
            />
        </LabelledEntry>
    )
}

function ComboBoxPropertyView({ note, property }: { note: FNote, property: ComboBoxProperty }) {
    const [ value, setValue ] = useNoteLabel(note, property.bindToLabel);

    return (
        <LabelledEntry label={property.label}>
            <FormSelectWithGroups
                values={property.options}
                keyProperty="value" titleProperty="label"
                currentValue={value ?? ""} onChange={setValue}
            />
        </LabelledEntry>
    )
}

function LabelledEntry({ label, children }: { label: string, children: ComponentChildren }) {
    return (
        <>
            <label>
                {label}
                &nbsp;&nbsp;
                {children}
            </label>
        </>
    )
}