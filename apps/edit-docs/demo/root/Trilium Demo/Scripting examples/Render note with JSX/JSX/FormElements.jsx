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
            <h2>Form elements</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1em" }}>
                <FormGroup name="checkbox" label="Checkbox">
                    <FormCheckbox label="Checkbox" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                </FormGroup>
                <FormGroup name="toggle" label="Toggle">
                    <FormToggle switchOnName="Off" switchOffName="On" currentValue={checkboxChecked} onChange={setCheckboxChecked} />
                </FormGroup>
                <FormGroup name="dropdown" label="Dropdown">
                    <FormDropdownList
                        values={[
                            { key: "key-1", name: "First item" },
                            { key: "key-2", name: "Second item" },
                            { key: "key-3", name: "Third item" },
                        ]}
                        currentValue={dropdownValue} onChange={setDropdownValue}
                        keyProperty="key" titleProperty="name"
                    />
                </FormGroup>
                <FormGroup name="radio-group" label="Radio group">
                    <FormRadioGroup
                        values={[
                            { value: "key-1", label: "First item" },
                            { value: "key-2", label: "Second item" },
                            { value: "key-3", label: "Third item" },
                        ]}
                        currentValue={radioGroupValue} onChange={setRadioGroupValue}
                    />
                </FormGroup>                
                <FormGroup name="text-box" label="Text box">
                    <FormTextBox
                        placeholder="Type something..."
                        currentValue="" onChange={(newValue) => {}}
                    />                
                </FormGroup>        
                <FormGroup name="text-area" label="Text area">
                    <FormTextArea
                        placeholder="Type something bigger..."
                        currentValue="" onChange={(newValue) => {}}
                    />
                </FormGroup>
                <FormGroup name="slider" label="Slider">
                    <Slider
                        min={1} max={100}
                        value={sliderValue} onChange={setSliderValue}
                    />
                </FormGroup>
                <FormGroup name="file-upload" label="File upload">
                    <FormFileUploadButton
                        text="Upload"
                        onChange={(files) => {
                            const file = files?.[0];
                            if (!file) return;
                            showMessage(`Got file "${file.name}" of size ${file.size} B and type ${file.type}.`);
                        }}
                    /> 
                </FormGroup>                
                <FormGroup name="icon" label="Icon">
                    <Icon icon="bx bx-smile" />
                </FormGroup>
                <FormGroup name="loading-spinner" label="Loading spinner">
                    <LoadingSpinner />
                </FormGroup>
                <FormGroup name="raw-html" label="Raw HTML">
                    <RawHtml html="<strong>Hi</strong> <em>there</em>" />
                </FormGroup>
            </div>
        </>
    )
}