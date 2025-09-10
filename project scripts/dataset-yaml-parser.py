import yaml
import pandas as pd

def process_yaml_to_csv(input_file_path, output_file_path):
    """
    Processes a YAML file containing datasource fields and reshapes it into a CSV
    where field names are columns and field values are rows.
    
    Parameters:
        input_file_path (str): Path to the input YAML file.
        output_file_path (str): Path to save the output CSV file.
    """
    # Load the YAML content
    with open(input_file_path, 'r') as file:
        yaml_content = yaml.safe_load(file)

    # Extract the datasource fields
    datasource_fields = yaml_content.get("datasourceFields", [])

    # Reshape data where field names are columns and values are rows
    reshaped_data = {}

    # Iterate over each field and align the data to the reshaped structure
    for field in datasource_fields:
        field_name = field["name"]
        field_values = field.get("fieldValues", [])
        reshaped_data[field_name] = field_values

    # Convert reshaped data to a DataFrame (transpose to align fields as columns)
    reshaped_df = pd.DataFrame.from_dict(reshaped_data, orient="index").transpose()

    # Save the reshaped DataFrame as CSV
    reshaped_df.to_csv(output_file_path, index=False)
    print(f"CSV file saved to {output_file_path}")

# Example usage
input_yaml_path = "/Users/srishti.palani/Desktop/LM-Eval/lm-comparison-app/backend/data/datasources/alpo-strange-goodall-189407.yaml"  # Replace with the path to datasource YAML file
output_csv_path = "dataset.csv"    # Replace with the path to save the CSV file
process_yaml_to_csv(input_yaml_path, output_csv_path)
