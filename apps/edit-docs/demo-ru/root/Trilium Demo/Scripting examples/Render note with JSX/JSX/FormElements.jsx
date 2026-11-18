import { 
    useState,
    FormCheckbox, FormDropdownList, FormFileUploadButton, FormGroup, FormRadioGroup, FormTextArea,
    FormTextBox, FormToggle, Slider, RawHtml, LoadingSpinner, Icon,
} from "trilium:preact";
    
export default function FormElements() {
    const [ checkboxChecked, setCheckboxChecked ] = useState(false);
    const [ dropdownValue, setDropdownValue ] = useState("key-1");
    const [ radioGroupValue, setRadioGroupValue ] = useState("key-1");
    const [ sliderValue, setSliderValue ] = useState(50);
    
    return (
        <>
            <h2>Элементы формы</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1em" }}>
                <FormGroup name="checkbox" label="Флажок">
                    <FormCheckbox label="Флажок" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                </FormGroup>
                <FormGroup name="toggle" label="Переключатель">
                    <FormToggle switchOnName="Выкл." switchOffName="Вкл." currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                </FormGroup>
                <FormGroup name="dropdown" label="Выпадающий список">
                    <FormDropdownList
                        values={[
                            { key: "key-1", name: "Первый пункт" },
                            { key: "key-2", name: "Второй пункт" },
                            { key: "key-3", name: "Третий пункт" },
                        ]}
                        currentValue={dropdownValue} onChange={setDropdownValue}
                        keyProperty="key" titleProperty="name"
                    />
                </FormGroup>
                <FormGroup name="radio-group" label="Группа переключателей">
                    <FormRadioGroup
                        values={[
                            { value: "key-1", label: "Первый пункт" },
                            { value: "key-2", label: "Второй пункт" },
                            { value: "key-3", label: "Третий пункт" },
                        ]}
                        currentValue={radioGroupValue} onChange={setRadioGroupValue}
                    />
                </FormGroup>                
                <FormGroup name="text-box" label="Текстовое поле">
                    <FormTextBox
                        placeholder="Введите текст…"
                        currentValue="" onChange={(newValue) => {}}
                    />                
                </FormGroup>        
                <FormGroup name="text-area" label="Многострочное поле">
                    <FormTextArea
                        placeholder="Введите более длинный текст…"
                        currentValue="" onChange={(newValue) => {}}
                    />
                </FormGroup>
                <FormGroup name="slider" label="Ползунок">
                    <Slider
                        min={1} max={100}
                        value={sliderValue} onChange={setSliderValue}
                    />
                </FormGroup>
                <FormGroup name="file-upload" label="Загрузка файла">
                    <FormFileUploadButton
                        text="Загрузить"
                        onChange={(files) => {
                            const file = files?.[0];
                            if (!file) return;
                            showMessage(`Got file "${file.name}" of size ${file.size} B and type ${file.type}.`);
                        }}
                    /> 
                </FormGroup>                
                <FormGroup name="icon" label="Значок">
                    <Icon icon="bx bx-smile" />
                </FormGroup>
                <FormGroup name="loading-spinner" label="Индикатор загрузки">
                    <LoadingSpinner />
                </FormGroup>
                <FormGroup name="raw-html" label="Raw HTML">
                    <RawHtml html="<strong>Привет</strong> <em>всем</em>" />
                </FormGroup>
            </div>
        </>
    )
}